#![no_std]

use dicekey_shared::{self as shared, TokenMeta};
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec};

#[contracttype]
#[derive(Clone)]
enum BenefitKey {
    Token(u64),
    OwnerTokens(Address), // user -> Vec<u64> of token IDs
    OwnerCount(Address),
    NextId,
    Initialized,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BenefitNft {
    pub id: u64,
    pub owner: Address,
    pub kind: String,
    pub expires_at: u64,
    pub meta: TokenMeta,
}

#[contract]
pub struct DicekeyBenefits;

#[contractimpl]
impl DicekeyBenefits {
    pub fn initialize(env: Env, admin: Address) {
        assert!(
            !env.storage().instance().has(&BenefitKey::Initialized),
            "already initialized"
        );
        shared::set_admin(&env, &admin);
        env.storage().instance().set(&BenefitKey::NextId, &0u64);
        env.storage()
            .instance()
            .set(&BenefitKey::Initialized, &true);
    }

    /// Read-only: whether `initialize()` has been called on this contract.
    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&BenefitKey::Initialized)
    }

    // ── SEP-50 NFT Interface ───────────────────────────

    pub fn name(env: Env) -> String {
        String::from_str(&env, "dicekey Benefits")
    }

    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "DICEKEY-BEN")
    }

    pub fn balance(env: Env, owner: Address) -> u64 {
        env.storage()
            .persistent()
            .get(&BenefitKey::OwnerCount(owner))
            .unwrap_or(0)
    }

    // ── Mint ───────────────────────────────────────────

    /// Mint a benefit NFT. Only callable by admin.
    pub fn mint(
        env: Env,
        admin: Address,
        to: Address,
        kind: String,
        expires_at: u64,
    ) -> u64 {
        shared::require_admin(&env, &admin);

        let id: u64 = env
            .storage()
            .instance()
            .get(&BenefitKey::NextId)
            .unwrap_or(0);

        let meta = TokenMeta {
            name: kind.clone(),
            description: String::from_str(&env, "dicekey Coffee Benefit"),
            image_uri: String::from_str(&env, ""),
            extra_uri: String::from_str(&env, ""),
        };

        let nft = BenefitNft {
            id,
            owner: to.clone(),
            kind,
            expires_at,
            meta,
        };

        env.storage()
            .persistent()
            .set(&BenefitKey::Token(id), &nft);

        Self::add_to_owner_list(&env, &to, id);

        let count: u64 = env
            .storage()
            .persistent()
            .get(&BenefitKey::OwnerCount(to.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&BenefitKey::OwnerCount(to.clone()), &(count + 1));

        env.storage()
            .instance()
            .set(&BenefitKey::NextId, &(id + 1));

        env.events().publish(
            (symbol_short!("benefit"), symbol_short!("mint")),
            (to, id),
        );

        id
    }

    // ── Transfer (gift) ────────────────────────────────

    /// Transfer a benefit NFT to another user (gift). Requires owner auth.
    pub fn transfer(env: Env, from: Address, to: Address, token_id: u64) {
        from.require_auth();

        let mut nft: BenefitNft = env
            .storage()
            .persistent()
            .get(&BenefitKey::Token(token_id))
            .expect("token not found");
        assert!(nft.owner == from, "not owner");

        // Check not expired
        assert!(
            nft.expires_at == 0 || nft.expires_at > env.ledger().timestamp(),
            "benefit expired"
        );

        nft.owner = to.clone();
        env.storage()
            .persistent()
            .set(&BenefitKey::Token(token_id), &nft);

        Self::remove_from_owner_list(&env, &from, token_id);
        Self::add_to_owner_list(&env, &to, token_id);

        // Update counts
        let from_count: u64 = env
            .storage()
            .persistent()
            .get(&BenefitKey::OwnerCount(from.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&BenefitKey::OwnerCount(from.clone()), &(from_count - 1));

        let to_count: u64 = env
            .storage()
            .persistent()
            .get(&BenefitKey::OwnerCount(to.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&BenefitKey::OwnerCount(to.clone()), &(to_count + 1));

        env.events().publish(
            (symbol_short!("benefit"), symbol_short!("xfer")),
            (from, to, token_id),
        );
    }

    // ── Burn (use) ─────────────────────────────────────

    /// Burn a benefit NFT (use it at store). Requires owner auth.
    pub fn burn(env: Env, owner: Address, token_id: u64) {
        owner.require_auth();

        let nft: BenefitNft = env
            .storage()
            .persistent()
            .get(&BenefitKey::Token(token_id))
            .expect("token not found");
        assert!(nft.owner == owner, "not owner");

        // Check not expired
        assert!(
            nft.expires_at == 0 || nft.expires_at > env.ledger().timestamp(),
            "benefit expired"
        );

        env.storage()
            .persistent()
            .remove(&BenefitKey::Token(token_id));

        Self::remove_from_owner_list(&env, &owner, token_id);

        let count: u64 = env
            .storage()
            .persistent()
            .get(&BenefitKey::OwnerCount(owner.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&BenefitKey::OwnerCount(owner.clone()), &(count - 1));

        env.events().publish(
            (symbol_short!("benefit"), symbol_short!("burn")),
            (owner, token_id),
        );
    }

    /// Burn a benefit NFT on behalf of its owner (store redemption).
    ///
    /// Admin-gated: only the configured admin (the HQ Smart Account) may call
    /// this, authorising via `shared::require_admin` (admin.require_auth). The
    /// effect is identical to `burn` — same owner check, expiry check, storage
    /// removal, owner-list removal, count decrement and event — but the auth is
    /// the admin's, not the voucher owner's, so a store terminal can redeem a
    /// customer's voucher without the customer signing. `burn` is unchanged.
    pub fn burn_from(env: Env, admin: Address, owner: Address, token_id: u64) {
        shared::require_admin(&env, &admin);

        let nft: BenefitNft = env
            .storage()
            .persistent()
            .get(&BenefitKey::Token(token_id))
            .expect("token not found");
        assert!(nft.owner == owner, "not owner");

        // Check not expired
        assert!(
            nft.expires_at == 0 || nft.expires_at > env.ledger().timestamp(),
            "benefit expired"
        );

        env.storage()
            .persistent()
            .remove(&BenefitKey::Token(token_id));

        Self::remove_from_owner_list(&env, &owner, token_id);

        let count: u64 = env
            .storage()
            .persistent()
            .get(&BenefitKey::OwnerCount(owner.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&BenefitKey::OwnerCount(owner.clone()), &(count - 1));

        env.events().publish(
            (symbol_short!("benefit"), symbol_short!("burn")),
            (owner, token_id),
        );
    }

    // ── Query ──────────────────────────────────────────

    pub fn get_token(env: Env, token_id: u64) -> BenefitNft {
        env.storage()
            .persistent()
            .get(&BenefitKey::Token(token_id))
            .expect("token not found")
    }

    pub fn owner_count(env: Env, owner: Address) -> u64 {
        Self::balance(env, owner)
    }

    /// List all benefit token IDs owned by a user.
    pub fn list_tokens(env: Env, owner: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&BenefitKey::OwnerTokens(owner))
            .unwrap_or(Vec::new(&env))
    }

    /// Total benefits ever minted.
    pub fn total_minted(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&BenefitKey::NextId)
            .unwrap_or(0)
    }

    // ── Internal ───────────────────────────────────────

    fn add_to_owner_list(env: &Env, owner: &Address, id: u64) {
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&BenefitKey::OwnerTokens(owner.clone()))
            .unwrap_or(Vec::new(env));
        ids.push_back(id);
        env.storage()
            .persistent()
            .set(&BenefitKey::OwnerTokens(owner.clone()), &ids);
    }

    fn remove_from_owner_list(env: &Env, owner: &Address, id: u64) {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&BenefitKey::OwnerTokens(owner.clone()))
            .unwrap_or(Vec::new(env));
        let mut new_ids: Vec<u64> = Vec::new(env);
        for existing_id in ids.iter() {
            if existing_id != id {
                new_ids.push_back(existing_id);
            }
        }
        env.storage()
            .persistent()
            .set(&BenefitKey::OwnerTokens(owner.clone()), &new_ids);
    }
}

// ── Tests ──────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup() -> (Env, DicekeyBenefitsClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(DicekeyBenefits, ());
        let client = DicekeyBenefitsClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);
        (env, client, admin)
    }

    #[test]
    fn test_name_symbol() {
        let (env, client, _) = setup();
        assert_eq!(client.name(), String::from_str(&env, "dicekey Benefits"));
        assert_eq!(client.symbol(), String::from_str(&env, "DICEKEY-BEN"));
    }

    #[test]
    fn test_mint() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);

        let kind = String::from_str(&env, "free_drink_voucher");
        let id = client.mint(&admin, &alice, &kind, &1_800_000_000);

        assert_eq!(id, 0);
        assert_eq!(client.balance(&alice), 1);
        assert_eq!(client.owner_count(&alice), 1);

        let token = client.get_token(&id);
        assert_eq!(token.owner, alice);
        assert_eq!(token.kind, kind);
        assert_eq!(token.expires_at, 1_800_000_000);
    }

    #[test]
    fn test_transfer_gift() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let kind = String::from_str(&env, "free_drink_voucher");
        let id = client.mint(&admin, &alice, &kind, &0);

        client.transfer(&alice, &bob, &id);

        assert_eq!(client.balance(&alice), 0);
        assert_eq!(client.balance(&bob), 1);

        let token = client.get_token(&id);
        assert_eq!(token.owner, bob);
    }

    #[test]
    fn test_burn() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);

        let kind = String::from_str(&env, "size_up_voucher");
        let id = client.mint(&admin, &alice, &kind, &0);
        client.burn(&alice, &id);

        assert_eq!(client.balance(&alice), 0);
    }

    #[test]
    fn test_list_tokens() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);

        let k1 = String::from_str(&env, "free_drink");
        let k2 = String::from_str(&env, "size_up");
        let k3 = String::from_str(&env, "50_off");

        let id0 = client.mint(&admin, &alice, &k1, &0);
        let id1 = client.mint(&admin, &alice, &k2, &0);
        let id2 = client.mint(&admin, &alice, &k3, &0);

        let tokens = client.list_tokens(&alice);
        assert_eq!(tokens.len(), 3);
        assert_eq!(tokens.get(0).unwrap(), id0);
        assert_eq!(tokens.get(1).unwrap(), id1);
        assert_eq!(tokens.get(2).unwrap(), id2);

        // Burn middle one
        client.burn(&alice, &id1);
        let tokens2 = client.list_tokens(&alice);
        assert_eq!(tokens2.len(), 2);
        assert_eq!(tokens2.get(0).unwrap(), id0);
        assert_eq!(tokens2.get(1).unwrap(), id2);
    }

    #[test]
    fn test_transfer_updates_lists() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let kind = String::from_str(&env, "voucher");
        let id = client.mint(&admin, &alice, &kind, &0);

        assert_eq!(client.list_tokens(&alice).len(), 1);
        assert_eq!(client.list_tokens(&bob).len(), 0);

        client.transfer(&alice, &bob, &id);

        assert_eq!(client.list_tokens(&alice).len(), 0);
        assert_eq!(client.list_tokens(&bob).len(), 1);
    }

    #[test]
    #[should_panic(expected = "not owner")]
    fn test_transfer_not_owner() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        let eve = Address::generate(&env);

        let kind = String::from_str(&env, "voucher");
        let id = client.mint(&admin, &alice, &kind, &0);
        client.transfer(&eve, &bob, &id);
    }

    #[test]
    fn test_burn_from_admin() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);

        let kind = String::from_str(&env, "free_drink_voucher");
        let id = client.mint(&admin, &alice, &kind, &0);
        assert_eq!(client.balance(&alice), 1);

        // Admin (HQ SA) burns alice's voucher without alice's auth.
        client.burn_from(&admin, &alice, &id);

        assert_eq!(client.balance(&alice), 0);
        assert_eq!(client.list_tokens(&alice).len(), 0);
    }

    #[test]
    #[should_panic(expected = "not authorized")]
    fn test_burn_from_non_admin() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let eve = Address::generate(&env);

        let kind = String::from_str(&env, "free_drink_voucher");
        let id = client.mint(&admin, &alice, &kind, &0);

        // A non-admin caller must not be able to burn another user's voucher.
        client.burn_from(&eve, &alice, &id);
    }

    #[test]
    #[should_panic(expected = "not owner")]
    fn test_burn_from_wrong_owner() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        let kind = String::from_str(&env, "free_drink_voucher");
        let id = client.mint(&admin, &alice, &kind, &0);

        // owner arg must match the token's actual owner.
        client.burn_from(&admin, &bob, &id);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_init() {
        let (_, client, admin) = setup();
        client.initialize(&admin);
    }

    #[test]
    fn test_total_minted() {
        let (env, client, admin) = setup();
        let alice = Address::generate(&env);
        let kind = String::from_str(&env, "voucher");

        client.mint(&admin, &alice, &kind, &0);
        client.mint(&admin, &alice, &kind, &0);
        assert_eq!(client.total_minted(), 2);
    }
}
