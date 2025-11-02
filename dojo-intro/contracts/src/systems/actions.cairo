use starknet::ContractAddress;
use core::integer::u256;

#[starknet::interface]
pub trait IActions<T> {
    fn redeem(ref self: T, score: u256);
}

#[dojo::contract]
pub mod actions {
    use super::IActions;
    use crate::models;
    use dojo::model::ModelStorage; // 👈 Import trait for write_model
    use dojo::world::{WorldStorage, WorldStorageTrait};

    #[abi(embed_v0)]
    impl ActionsImpl of IActions<ContractState> {
        fn redeem(ref self: ContractState, score: u256) {
            let player = starknet::get_caller_address();
            let mut world = self.world_default();

            let redeem = models::Redeem {
                player,
                score,
            };

            world.write_model(@redeem); // ✅ Now available
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn world_default(self: @ContractState) -> WorldStorage {
            self.world(@"take_your_shot")
        }
    }
}   
