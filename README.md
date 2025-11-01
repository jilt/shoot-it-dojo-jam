# Shoot-it-dojo-jam
Repository for a 3D first person shooter game built on Starknet with DojoEngine
[Demo](https://www.jeeltcraft.com)

# Vesu liquidator changes: #
The liquidation bot is based on the [official vesu bot](https://github.com/astraly-labs/vesu-liquidator), connected to the plasma oracles API.

## New Function find_next_player_in_queue: ##

This function is responsible for querying the Torii GraphQL endpoint.
It asks for the first: 1 redeemModels. This is a simple way to get the "next" player. A more sophisticated queue might sort by block number or score, but this is a robust starting point.
It returns an Option<FieldElement>, giving us the address of the player who is next in line to receive funds.

## Modified liquidate_position ##

This is the core of the new integration. When a position is deemed liquidatable, it first calls find_next_player_in_queue.
If a player is found in the queue, their address is used as the recipient for the liquidation transaction.
If the queue is empty (the function returns None), it falls back to using the liquidator bot's own address as the recipient. This is a safe default to prevent the transaction from failing.
It then proceeds with the liquidation, sending the earnings to the determined recipient.
This revised approach correctly combines the price-based opportunity finding with the on-chain Redeem queue for distributing earnings. The system is now event-driven in two ways: it reacts to price changes and consumes events (the Redeem queue) from the Dojo world.

## Configuration changes ##

Without adding torii_graphql_url to your Config struct and your configuration file (e.g., config.toml), the bot will fail when it tries to find a player in the redeem queue, this URL typically looks like http://localhost:8080/graphql. 


## overall liquidation logic ##

The bot finds a valid, liquidatable Position from its existing map (self.positions).
It then calls liquidate_position with that valid Position object.
Inside that function, it finds a recipient from the Redeem queue.
It passes the recipient to position.get_vesu_liquidate_tx.

## Game sustainability ##

New HighestScoreModel Struct: 
Added to monitoring.rs to deserialize the new global high score model from Torii.

New get_highest_score Function: 
This function queries the Torii GraphQL endpoint for the singleton HighestScore model and returns the score.

Refactored liquidate_position:
The recipient for the initial Vesu liquidation call is now hardcoded to be the bot's own address. This is crucial, as the bot must first collect the full profit before it can distribute it.
After the liquidation is confirmed (wait_for_tx), the new distribution logic begins.
It calls find_next_player_in_queue and get_highest_score.
Proportional Calculation: It calculates the player_share based on the 100% ratio.
Placeholder for Earnings: A critical part of this logic is to get the total_earnings from the liquidation. This value must be parsed from the events in the transaction receipt. I've left a placeholder comment where this logic needs to be implemented, as it's specific to the Vesu contract's events.

New transfer_erc20 Helper:
I've added a multicall transaction to execute both transfers (to the player and the world) atomically.

We need to:

World Address: Ensure that self.config.world_address in liquidate_position correctly points to your Dojo World contract address (src/config.rs and config.yaml), as that's where the remainder of the funds will be sent.

Remember:
_singleton_address: Used for interacting with the Vesu DeFi protocol. The bot reads position data from this address.
_world_address: Used for interacting with the Dojo game world. The bot sends liquidation remainders to this address.


## Credits
Torment Textures by Bradley D. (https://strideh.itch.io)

[basic game code that we developed upon](https://github.com/aarcoraci)
