import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { OrbitalPulse } from "../target/types/orbital_pulse";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("orbital-pulse-final-run", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.OrbitalPulse as Program<OrbitalPulse>;
  const signer = provider.wallet.publicKey;
  const stateAccount = anchor.web3.Keypair.generate();

  it("Акт рождения Orbital Pulse: от калибровки к осознанному ритму", async () => {
    const [mintPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("orbital-genesis")], 
      program.programId
    );
    const tokenAccount = getAssociatedTokenAddressSync(
      mintPda, 
      signer, 
      false, 
      TOKEN_PROGRAM_ID, 
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    console.log("--- ИНИЦИАЛИЗАЦИЯ АККАУНТА ---");
    await program.methods
      .initialize(new anchor.BN(3)) // Порог градиента 3%
      .accounts({
        state: stateAccount.publicKey,
        mint: mintPda,
        tokenAccount: tokenAccount,
        signer: signer,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([stateAccount])
      .rpc();

    const modes = ["S0 (IDLE)", "S1 (CONTROL)", "S2 (EVOLVE)"];
    console.log("--- СТАНОВЛЕНИЕ СИСТЕМЫ (30 ШАГОВ) ---");

    for (let i = 1; i <= 30; i++) {
      try {
        await program.methods.tryTransition().accounts({
          state: stateAccount.publicKey,
          mint: mintPda,
          tokenAccount: tokenAccount,
          slotHashes: new anchor.web3.PublicKey("SysvarS1otHashes111111111111111111111111111"),
          signer: signer,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();

        const state = await program.account.pulseState.fetch(stateAccount.publicKey);
        
        if (!state.isBorn) {
          console.log(`[T=${i}] Настройка вакуума... Накоплено: ${state.calibCount}/16`);
        } else {
          // Безопасное преобразование через String -> BigInt
          const varIdx = BigInt(state.varianceIndex.toString());
          const eps = BigInt(state.epsilon.toString());
          const xVal = BigInt(state.xControl.toString());
          
          // Вычисление динамического предела X_max
          const xMax = varIdx > eps ? varIdx : (eps > 0n ? eps : 1n);
          
          // Расчет давления в процентах (умножаем на 1000 для точности одного знака после запятой)
          const load = (Number(xVal * 1000n / xMax) / 10).toFixed(1);

          // Сокращаем длинные числа для чистоты лога
          const fmtEps = eps.toString().padStart(5, '0');
          const fmtEng = varIdx.toString().padStart(5, '0');

          console.log(
            `[T=${i}] ${modes[state.mode] || "S2"} | ` +
            `Vac(Eps): ${fmtEps.slice(0, 10)} | ` +
            `Eng: ${fmtEng.slice(0, 10)} | ` +
            `Press: ${load}%`
          );
        }
      } catch (err) {
        console.error(`Ошибка на шаге ${i}:`, err);
        break;
      }
    }
  });
});
