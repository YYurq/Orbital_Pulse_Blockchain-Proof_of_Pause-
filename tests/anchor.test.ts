import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { OrbitalEngine } from "../target/types/orbital_engine";
import { expect } from "chai";
import { 
  getAssociatedTokenAddressSync, 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from "@solana/spl-token";

describe("orbital-pulse-tests", () => {
  // Настройка провайдера
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // Ссылка на вашу программу
  const program = anchor.workspace.OrbitalEngine as Program<OrbitalEngine>;

  // Генерация ключевой пары для состояния системы
  const stateAccount = anchor.web3.Keypair.generate();
  const signer = provider.wallet.publicKey;

  // Расчет PDA для Mint (Генезис-актив)
  const [mintPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("orbital-genesis")],
    program.programId
  );

  // Расчет адреса токен-аккаунта пользователя
  const tokenAccount = getAssociatedTokenAddressSync(
    mintPda,
    signer,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  it("Инициализация ядра и Генезис $ORBIT", async () => {
    const epsilon = new anchor.BN(1000000); // Порог для Закона Допуска

    await program.methods
      .initialize(epsilon)
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

    // Проверка баланса после инициализации
    const balance = await provider.connection.getTokenAccountBalance(tokenAccount);
    console.log("Генезис-баланс:", balance.value.uiAmount);
    expect(balance.value.uiAmount).to.equal(3);
  });

  it("Попытка Орбитального перехода (ТФАПСИ)", async () => {
    try {
      const tx = await program.methods
        .tryTransition()
        .accounts({
          state: stateAccount.publicKey,
          mint: mintPda,
          tokenAccount: tokenAccount,
          slotHashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY,
          signer: signer,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      
      console.log("Транзакция перехода отправлена:", tx);
      
      const state = await program.account.pulseState.fetch(stateAccount.publicKey);
      console.log("Текущая орбита:", state.currentOrbit);
      console.log("Счетчик Пауз:", state.pauseCount.toString());
    } catch (err) {
      console.log("Переход не случился (Дельта > Epsilon):", err);
    }
  });
});
