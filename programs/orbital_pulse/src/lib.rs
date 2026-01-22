use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::solana_program::sysvar::slot_hashes;

declare_id!("3o6We5WQoGDM6wpQMPq5VE3fjvC7zgCUD56X12vLn917");

const MIN_GRAD: u64 = 1;
const MAX_GRAD: u64 = 10;
const DEF_GRAD: u64 = 2;

#[program]
pub mod orbital_pulse {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, epsilon: u64, threshold_percent: Option<u64>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.authority = ctx.accounts.signer.key();
        state.epsilon = epsilon;
        state.current_depth = 11;
        let p = threshold_percent.unwrap_or(DEF_GRAD);
        state.gradient_threshold_percent = p.clamp(MIN_GRAD, MAX_GRAD);
        state.last_noise = 0;
        state.current_orbit = 0;
        state.head = 0;
        state.variance_index = 0;
        state.prev_variance_index = 0;
        state.last_fine_log = 0;
        Ok(())
    }

    pub fn try_transition(ctx: Context<Transition>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        let hash: [u8; 32] = data[12..44].try_into().map_err(|_| ErrorCode::HashNotFound)?;
        let n_hash = hashv(&[&hash, &state.authority.to_bytes()]);
        let noise = u64::from_le_bytes(n_hash.as_ref()[0..8].try_into().unwrap());
        let delta = if noise > state.last_noise { noise - state.last_noise } else { state.last_noise - noise };

        let h_idx = state.head as usize;
        state.history[h_idx] = delta;
        state.head = (state.head + 1) % 16;

        let d_v = state.current_depth as u128;
        if d_v == 0 { return Err(ErrorCode::InvalidDepth.into()); }

        let mut sum: u128 = 0;
        let c_h = state.head as usize;
        for i in 0..state.current_depth as usize {
            let idx = (c_h + 16 - 1 - i) % 16;
            sum += state.history[idx] as u128;
        }
        let avg = sum / d_v;
        
        let mut v_sum: u128 = 0;
        for i in 0..state.current_depth as usize {
            let idx = (c_h + 16 - 1 - i) % 16;
            let val = state.history[idx] as u128;
            let diff = if val > avg { val - avg } else { avg - val };
            v_sum = v_sum.saturating_add(diff.saturating_mul(diff));
        }

        let m_v = v_sum / d_v;
        let msb = 128 - m_v.leading_zeros() as i32;
        let f_log = if msb > 8 {
            ((msb as u64) << 8) + ((m_v >> (msb - 8)) & 0xFF) as u64
        } else if msb > 0 { (msb as u64) << 8 } else { 0 };

        state.last_fine_log = f_log;
        state.prev_variance_index = state.variance_index;
        state.variance_index = (state.variance_index.saturating_mul(4).saturating_add(f_log)) / 5;
        
        let grad = state.variance_index as i64 - state.prev_variance_index as i64;
        let thr = state.variance_index.saturating_mul(state.gradient_threshold_percent) / 100;

        if grad < -(thr as i64) && state.current_depth > 7 { state.current_depth -= 1; }
        else if grad > (thr as i64) && state.current_depth < 15 { state.current_depth += 1; }

        if delta < state.epsilon && state.variance_index < (state.epsilon.saturating_mul(10)) {
            state.current_orbit = (state.current_orbit + 1) % 5;
            let seeds = &[b"orbital-genesis".as_ref(), &[ctx.bumps.mint]];
            token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.mint.to_account_info(),
            }, &[&seeds[..]]), 100_000_000)?;
            state.epsilon = state.epsilon.saturating_sub(state.epsilon / 100);
        }
        state.last_noise = noise;
        Ok(())
    }
}

#[account]
pub struct PulseState {
    pub authority: Pubkey,        
    pub last_noise: u64,          
    pub epsilon: u64,             
    pub current_orbit: u8,        
    pub history: [u64; 16],       
    pub current_depth: u8,        
    pub head: u8,                 
    pub variance_index: u64,      
    pub prev_variance_index: u64, 
    pub last_fine_log: u64,
    pub gradient_threshold_percent: u64,
}

impl PulseState {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1 + 128 + 1 + 1 + 8 + 8 + 8 + 8;
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = signer, space = PulseState::LEN)]
    pub state: Account<'info, PulseState>,
    #[account(init_if_needed, payer = signer, mint::decimals = 9, mint::authority = mint, seeds = [b"orbital-genesis"], bump)]
    pub mint: Account<'info, Mint>,
    #[account(init_if_needed, payer = signer, associated_token::mint = mint, associated_token::authority = signer)]
    pub token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Transition<'info> {
    #[account(mut)]
    pub state: Account<'info, PulseState>,
    #[account(mut, seeds = [b"orbital-genesis"], bump)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    #[account(address = slot_hashes::ID)]
    pub slot_hashes: AccountInfo<'info>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Err: Hash")] HashNotFound,
    #[msg("Err: Depth")] InvalidDepth,
}
