use starknet::ContractAddress;

#[starknet::interface]
pub trait IActions<T> {
    fn redeem(ref self: T, recipient: ContractAddress);
}

#[dojo::contract]
pub mod actions {
    use super::IActions;
    use crate::models::Redeem;
    use dojo::model::ModelStorage;

    #[abi(embed_v0)]
    impl ActionsImpl of IActions<ContractState> {
        fn redeem(ref self: ContractState, recipient: ContractAddress) {
            let mut world = self.world_default();
            let player = starknet::get_caller_address();

