use starknet::ContractAddress;
use core::integer::u256;

// Enum to define the possible actions a player can take.
// We derive Serde so it can be stored in the model.
#[derive(Serde, Copy, Drop, Introspect)]
pub enum Actions {
    Redeem: (),
    Stake: (),
}

// The Player model now stores the player's address, their score,
// and the final action they took.
#[dojo::model]
#[derive(Copy, Drop, Serde)]
pub struct Player {
    #[key]
    pub address: ContractAddress,
    pub score: u32,
    pub action: Actions,
}

// The Redeem model stores the player's choice of recipient for liquidation funds.
// This acts as a "reservation".
#[dojo::model]
#[derive(Copy, Drop, Serde)]
pub struct Redeem {
    #[key]
    pub player: ContractAddress,
    pub score: u256,
}
