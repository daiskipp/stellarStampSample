#![no_std]

use soroban_sdk::{contracttype, Address, String};

/// Metadata attached to every stamp/badge/benefit NFT.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TokenMeta {
    pub name: String,
    pub description: String,
    pub image_uri: String,
    pub extra_uri: String,
}

/// Venues (store locations) are identified by short string keys.
/// e.g. "shibuya", "shinjuku", "kyoto"
pub type VenueId = String;

/// Common error codes shared across contracts.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum DicekeyError {
    NotAuthorized = 1,
    AlreadyClaimed = 2,
    Expired = 3,
    NotFound = 4,
    InvalidInput = 5,
    PolicyNotMet = 6,
}

/// Admin storage key — all contracts use the same key for admin address.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
}

/// Helper to read the admin address from storage.
pub fn get_admin(env: &soroban_sdk::Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin not set")
}

/// Helper to set the admin address in storage.
pub fn set_admin(env: &soroban_sdk::Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

/// Helper to require that the caller is the admin.
pub fn require_admin(env: &soroban_sdk::Env, caller: &Address) {
    let admin: Address = get_admin(env);
    if *caller != admin {
        panic!("not authorized");
    }
    caller.require_auth();
}
