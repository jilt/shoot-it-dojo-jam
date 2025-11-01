use std::{sync::Arc, time::Duration};

use anyhow::{Result, anyhow};
use futures_util::lock::Mutex;
use starknet::{core::{types::{BlockId, BlockTag, Event, FieldElement, FunctionCall}, utils::get_selector_from_name}, providers::{JsonRpcClient, jsonrpc::HttpTransport}};
use tokio::task::JoinSet;
use tokio::{
    sync::mpsc::UnboundedReceiver,
    time::{interval, sleep},
};

use crate::bindings::liquidate::Liquidate;
use crate::types::StarknetSingleOwnerAccount;
use crate::{
    config::Config,
    services::oracle::LatestOraclePrices,
    storages::Storage,
    types::{
        account::StarknetAccount,
        position::{Position, PositionsMap},
    },
    utils::{services::Service, wait_for_tx},
};

/// Represents the structure of a Redeem model from Torii's GraphQL response.
#[derive(serde::Deserialize, Debug)]
struct RedeemModel {
    player: String,
    score: u128, // Assuming score fits in u128 for simplicity in Rust.
}

/// Represents the structure of a HighestScore model from Torii.
#[derive(serde::Deserialize, Debug)]
struct HighestScoreModel {
    id: u8,
    score: u128, // Assuming score fits in u128.
}

#[derive(Clone)]
pub struct MonitoringService {
    liquidate_contract: Arc<Liquidate<StarknetSingleOwnerAccount>>,
    config: Config,
    rpc_client: Arc<JsonRpcClient<HttpTransport>>,
    account: Arc<StarknetAccount>,
    positions_receiver: Arc<Mutex<UnboundedReceiver<(u64, Position)>>>,
    // This map is kept to manage ongoing liquidations or complex state if needed in the future.
    positions: PositionsMap,
    latest_oracle_prices: LatestOraclePrices,
    storage: Arc<Mutex<Box<dyn Storage>>>,
    http_client: reqwest::Client,
}

#[async_trait::async_trait]
impl Service for MonitoringService {
    async fn start(&mut self, join_set: &mut JoinSet<anyhow::Result<()>>) -> anyhow::Result<()> {
        let service = self.clone();
        // We wait a few seconds before starting the monitoring service to be sure that we have prices
        // + indexed a few positions.
        sleep(Duration::from_secs(4)).await;
        join_set.spawn(async move {
            tracing::info!("🔭 Monitoring service started");
            service.run_forever().await?;
            Ok(())
        });
        Ok(())
    }
}

impl MonitoringService {
    pub fn new(
        config: Config,
        rpc_client: Arc<JsonRpcClient<HttpTransport>>,
        account: StarknetAccount,
        positions_receiver: UnboundedReceiver<(u64, Position)>,
        latest_oracle_prices: LatestOraclePrices,
        storage: Box<dyn Storage>,
    ) -> MonitoringService {
        MonitoringService {
            liquidate_contract: Arc::new(Liquidate::new(
                config.liquidate_address,
                account.0.clone(),
            )),
            config,
            rpc_client,
            account: Arc::new(account),
            positions_receiver: Arc::new(Mutex::new(positions_receiver)),
            positions: PositionsMap::from_storage(storage.as_ref()),
            latest_oracle_prices,
            storage: Arc::new(Mutex::new(storage)),
            http_client: reqwest::Client::new(),
        }
    }

    /// Starts the monitoring service.
    pub async fn run_forever(&self) -> Result<()> {
        const CHECK_POSITIONS_INTERVAL: u64 = 3500;
        let mut update_interval = interval(Duration::from_millis(CHECK_POSITIONS_INTERVAL));

        loop {
            let mut receiver = self.positions_receiver.lock().await;

            tokio::select! {
                _ = update_interval.tick() => {
                    drop(receiver);
                    self.monitor_positions_liquidability().await?;
                }

                maybe_position = receiver.recv() => {
                    drop(receiver);
                    match maybe_position {
                        Some((block_number, mut new_position)) => {
                            new_position
                                .update(&self.rpc_client, &self.config.singleton_address)
                                .await?;
                            if new_position.is_closed() {
                                continue;
                            }
                            self.positions.0.insert(new_position.key(), new_position);
                            self.storage.lock().await.save(&self.positions.0, block_number).await?;
                        }
                        None => {
                            return Err(anyhow!("Monitoring stopped unexpectedly"));
                        }
                    }
                }
            }
        }
    }

    /// Update all monitored positions and check if it's worth to liquidate any.
    async fn monitor_positions_liquidability(&self) -> Result<()> {
        if self.positions.0.is_empty() {
            return Ok(());
        }

        let position_keys: Vec<u64> = self.positions.0.iter().map(|entry| *entry.key()).collect();
        let mut positions_to_delete = vec![];

        for key in position_keys {
            if let Some(mut entry) = self.positions.0.get_mut(&key) {
                let position = entry.value_mut();

                if !position.is_liquidable(&self.latest_oracle_prices).await? {
                    continue;
                }
                tracing::info!(
                    "[🔭 Monitoring] Liquidatable position found #{}!",
                    position.key()
                );

                tracing::info!("[🔭 Monitoring] 🔫 Liquidating position...");
                if let Err(e) = self.liquidate_position(position).await {
                    if e.to_string().contains("not-undercollateralized") {
                        tracing::warn!("[🔭 Monitoring] Position was not under collateralized!");
                        positions_to_delete.push(key);
                        continue;
                    } else {
                        tracing::error!(
                            error = %e,
                            "[🔭 Monitoring] 😨 Could not liquidate position #{:x}",
                            position.key(),
                        );
                    }
                }

                position
                    .update(&self.rpc_client, &self.config.singleton_address)
                    .await?;
            }
        }

        for to_delete in positions_to_delete {
            self.positions.0.remove(&to_delete);
        }

        Ok(())
    }

    /// Queries the Torii GraphQL endpoint for Redeem models within a block range.
    async fn find_next_player_in_queue(&self) -> Result<Option<RedeemModel>> {
        let query = format!(
            r#"
            query {{
                redeemModels(first: 1) {{
                    edges {{
                        node {{
                            player, score
                        }}
                    }}
                }}
            }}
            "#
        );

        let response: serde_json::Value = self
            .http_client
            .post(&self.config.torii_graphql_url)
            .json(&serde_json::json!({ "query": query }))
            .send()
            .await?
            .json()
            .await?;

        let models: Vec<RedeemModel> = serde_json::from_value(
            response["data"]["redeemModels"]["edges"]
                .as_array()
                .ok_or_else(|| anyhow!("Invalid GraphQL response format"))?
                .iter()
                .map(|edge| edge["node"].clone())
                .collect::<serde_json::Value>(),
        )?;

        Ok(models.into_iter().next())
    }

    /// Queries Torii for the global highest score.
    async fn get_highest_score(&self) -> Result<Option<u128>> {
        let query = r#"
            query {
                highestScoreModels(first: 1) {
                    edges {
                        node {
                            id, score
                        }
                    }
                }
            }
        "#;

        let response: serde_json::Value = self
            .http_client
            .post(&self.config.torii_graphql_url)
            .json(&serde_json::json!({ "query": query }))
            .send()
            .await?
            .json()
            .await?;

        let models: Vec<HighestScoreModel> = serde_json::from_value(
            response["data"]["highestScoreModels"]["edges"]
                .as_array()
                .ok_or_else(|| anyhow!("Invalid GraphQL response format for HighestScore"))?
                .iter()
                .map(|edge| edge["node"].clone())
                .collect::<serde_json::Value>(),
        )?;

        Ok(models.first().map(|m| m.score))
    }

    /// Transfers a given amount of an ERC20 token to a recipient.
    fn build_erc20_transfer_call(&self, token_address: FieldElement, recipient: FieldElement, amount: U256) -> Result<FunctionCall> {
        Ok(FunctionCall {
            contract_address: token_address,
            entry_point_selector: get_selector_from_name("transfer")?,
            calldata: vec![recipient, amount.low.into(), amount.high.into()], // recipient, amount_low, amount_high
        })
    }

    /// Check if a position is liquidable, finds a recipient from the redeem queue,
    /// and if it's worth it, liquidates it.
    async fn liquidate_position(&self, position: &Position) -> Result<()> {
        let started_at = std::time::Instant::now();
        
        // The liquidator bot's address will be the initial recipient of all earnings.
        let bot_address = self.account.account_address();

        let liquidation_tx = position
            .get_vesu_liquidate_tx(&self.liquidate_contract, &self.http_client, &bot_address)
            .await?;
        
        let tx_hash = self.account.execute_txs(&[liquidation_tx]).await?;
        let receipt = wait_for_tx(&self.rpc_client, tx_hash).await?;

        // --- Proportional Reward Logic ---
        // After a successful liquidation, distribute the earnings based on player scores.
        // After a successful liquidation, we find the next player and distribute the earnings.
        if let Some(redeemer) = self.find_next_player_in_queue().await? {
            tracing::info!("[💸 Distribution] Found player in queue: {}", redeemer.player);

            let highest_score = self.get_highest_score().await?.unwrap_or(redeemer.score); // Fallback to player's score if no global high score.
            if highest_score == 0 {
                tracing::warn!("[💸 Distribution] Highest score is 0, cannot calculate proportion.");
                return Ok(());
            }

            // 1. Parse the actual liquidation earnings from the transaction events.
            let (collateral_token_address, total_earnings) =
                match parse_liquidation_event(&receipt.events, self.liquidate_contract.address()) {
                    Some(data) => data,
                    None => {
                        tracing::error!("[💸 Distribution] Could not find or parse Liquidation event in tx {:#x}", tx_hash);
                        return Ok(());
                    }
                };

            // 2. Calculate the player's proportional share of the earnings.
            // The `total_earnings` is a u256, but for the f64 calculation, we'll convert it.
            // This is safe for any reasonable token amount.
            let total_earnings_f64 = (total_earnings.low as f64) + ((total_earnings.high as f64) * 2.0_f64.powi(128));

            // The player's score is also a u128.
            let player_score_f64 = redeemer.score as f64;
            let highest_score_f64 = highest_score as f64;

            // The proportion is (player_score / highest_score).
            let player_share_f64 = total_earnings_f64 * (player_score_f64 / highest_score_f64);
            let player_share_u128 = player_share_f64 as u128;

            let player_share = U256 { low: player_share_u128, high: 0 };
            let world_share = total_earnings - player_share;

            tracing::info!(
                "[💸 Distribution] Player Score: {}, Highest Score: {}, Total Earnings: {}",
                redeemer.score, highest_score, total_earnings_f64
            );
            tracing::info!("[💸 Distribution] Player Share: {}, World Share: {}", player_share.low, world_share.low);

            // 3. Distribute the funds: player's share to the player, remainder to the world contract.
            let player_address = FieldElement::from_hex_be(&redeemer.player)?;
            let world_address = self.config.world_address;

            let player_transfer_call = self.build_erc20_transfer_call(collateral_token_address, player_address, player_share)?;
            let world_transfer_call = self.build_erc20_transfer_call(collateral_token_address, world_address, world_share)?;

            tracing::info!("[💸 Distribution] Executing distribution multicall...");
            let dist_tx_hash = self.account.execute_txs(&[player_transfer_call, world_transfer_call]).await?;
            wait_for_tx(&self.rpc_client, dist_tx_hash).await?;
            tracing::info!("[💸 Distribution] ✅ Distribution complete! (tx {:#x})", dist_tx_hash);
            }
        tracing::info!(
            "[🔭 Monitoring] ✅ Liquidated position #{}! (tx {tx_hash:#064x}) - ⌛ {:?}",
            position.key(),
            started_at.elapsed()
        );
        Ok(())
    }
}

/// A simple struct to hold a u256 value.
#[derive(Debug, Clone, Copy)]
pub struct U256 {
    pub low: u128,
    pub high: u128,
}

impl std::ops::Sub for U256 {
    type Output = Self;

    fn sub(self, rhs: Self) -> Self::Output {
        let (low, borrow) = self.low.overflowing_sub(rhs.low);
        let high = if borrow {
            // We also need to subtract the borrow from the high part.
            self.high.saturating_sub(rhs.high).saturating_sub(1)
        } else {
            self.high.saturating_sub(rhs.high)
        };
        Self { low, high }
    }
}

/// Parses the events from a transaction receipt to find the `Liquidation` event
/// and extracts the collateral asset and amount.
///
/// # Arguments
/// * `events` - A slice of `Event` from a transaction receipt.
/// * `contract_address` - The address of the contract that is expected to emit the event.
///
/// # Returns
/// An `Option` containing a tuple of `(collateral_asset_address, liquidated_amount)`.
fn parse_liquidation_event(events: &[Event], contract_address: FieldElement) -> Option<(FieldElement, U256)> {
    let event_key = get_selector_from_name("Liquidation").ok()?;

    for event in events {
        if event.from_address == contract_address && !event.keys.is_empty() && event.keys[0] == event_key {
            // Assuming event structure: `collateral_asset: ContractAddress`, `liquidated_collateral_amount: u256`
            if event.data.len() >= 3 {
                let collateral_asset = event.data[0];
                let amount_low = event.data[1].try_into().ok()?;
                let amount_high = event.data[2].try_into().ok()?;
                return Some((collateral_asset, U256 { low: amount_low, high: amount_high }));
            }
        }
    }

    None
}
