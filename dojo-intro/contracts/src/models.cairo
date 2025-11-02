use starknet::ContractAddress;
use core::integer::u256;

// Enum to define the possible actions a player can take.
#[derive(Serde, Copy, Drop, Introspect)]
pub enum Actions {
    Redeem: (),
    Stake: (),
}

// The Player model now stores the player's address, their score,
// and the final action they took.
#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct Player {
    #[key]
    pub address: ContractAddress,
    pub score: u256,
    pub action: u8,
}

// The Redeem model stores the player's choice of recipient for liquidation funds.
// This acts as a "reservation".
#[derive(Copy, Drop, Serde)]
#[dojo::model]
pub struct Redeem {
    #[key]
    pub player: ContractAddress,
    pub score: u256,
}
