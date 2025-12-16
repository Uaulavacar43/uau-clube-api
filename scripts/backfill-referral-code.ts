/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";

type Args = {
    dryRun: boolean;
    batchSize: number;
    concurrency: number;
    codeLen: number;
    maxAttemptsPerUser: number;
};

const prisma = new PrismaClient();

function parseArgs(argv: string[]): Args {
    const get = (name: string) => {
        const idx = argv.indexOf(name);
        if (idx === -1) return undefined;
        return argv[idx + 1];
    };

    const has = (name: string) => argv.includes(name);

    const dryRun = has("--dry-run");
    const batchSize = Number(get("--batch-size") ?? "500");
    const concurrency = Number(get("--concurrency") ?? "5");
    const codeLen = Number(get("--code-len") ?? "8");
    const maxAttemptsPerUser = Number(get("--max-attempts") ?? "15");

    if (!Number.isFinite(batchSize) || batchSize <= 0) throw new Error("Invalid --batch-size");
    if (!Number.isFinite(concurrency) || concurrency <= 0) throw new Error("Invalid --concurrency");
    if (!Number.isFinite(codeLen) || codeLen < 6 || codeLen > 12) throw new Error("Invalid --code-len (use 6..12)");
    if (!Number.isFinite(maxAttemptsPerUser) || maxAttemptsPerUser <= 0) throw new Error("Invalid --max-attempts");

    return { dryRun, batchSize, concurrency, codeLen, maxAttemptsPerUser };
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Alfabeto Base32 (32 chars). Evita caracteres ambíguos (0/O/I/1).
 * IMPORTANTE: tamanho precisa ser exatamente 32.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
if (ALPHABET.length !== 32) throw new Error("ALPHABET must have 32 chars");

// Para obfuscar (sem colisões), usamos uma permutação modular em 2^(5*codeLen).
// REFERRAL_SALT precisa ser constante entre execuções (opcional).
const SALT = BigInt(process.env.REFERRAL_SALT ?? "987654321");
const MULT = 1103515245n; // ímpar => invertível módulo 2^N

function encodeBase32Fixed(n: bigint, codeLen: number): string {
    const mask = 31n; // 0b11111
    let out = "";
    for (let i = 0; i < codeLen; i++) {
        const idx = Number(n & mask);
        out = ALPHABET[idx] + out;
        n >>= 5n;
    }
    return out;
}

/**
 * Gera referralCode determinístico, com baixa previsibilidade.
 * - Sem colisão para ids int32 (até 2^31-1) com codeLen=8 (2^40 espaço).
 * - Não depende de random.
 */
function genReferralCode(id: number, codeLen: number): string {
    const bits = BigInt(5 * codeLen);
    const mod = 1n << bits; // 2^(5*len)
    const x = (BigInt(id) * MULT + SALT) % mod;
    return encodeBase32Fixed(x, codeLen);
}

async function runPool<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
) {
    const executing = new Set<Promise<void>>();

    for (const item of items) {
        const p = (async () => worker(item))()
            .catch(() => {
                // erro já contabilizado no worker
            })
            .finally(() => executing.delete(p));

        executing.add(p);

        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }
    }

    await Promise.all(executing);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    console.log("\n=== Backfill referralCode (ONLY NULL) ===");
    console.log({
        dryRun: args.dryRun,
        batchSize: args.batchSize,
        concurrency: args.concurrency,
        codeLen: args.codeLen,
        maxAttemptsPerUser: args.maxAttemptsPerUser,
        alphabetLen: ALPHABET.length,
        salt: String(SALT),
    });

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    // Primeiro check: quantos faltam
    const totalRemaining = await prisma.user.count({
        where: { referralCode: null },
    });

    console.log(`Remaining at start: ${totalRemaining}`);
    if (totalRemaining === 0) {
        console.log("Nothing to do.");
        return;
    }

    while (true) {
        // Sempre pegue apenas NULL (sem cursor por id) — garante que falhas não ficam para trás.
        const users = await prisma.user.findMany({
            where: { referralCode: null },
            select: { id: true },
            orderBy: { id: "asc" },
            take: args.batchSize,
        });

        if (users.length === 0) break;

        await runPool(users, args.concurrency, async (u) => {
            processed++;

            const code = genReferralCode(u.id, args.codeLen);

            if (args.dryRun) {
                skipped++;
                return;
            }

            for (let attempt = 1; attempt <= args.maxAttemptsPerUser; attempt++) {
                try {
                    await prisma.user.update({
                        where: { id: u.id },
                        data: { referralCode: code },
                    });
                    updated++;
                    return;
                } catch (e: any) {
                    // Pool estourado / timeout do Prisma (P2024)
                    if (e?.code === "P2024") {
                        const backoff = Math.min(2000, 200 * attempt);
                        await sleep(backoff);
                        continue;
                    }

                    // Unique violation (P2002): extremamente improvável aqui (determinístico),
                    // mas deixamos tratamento para não travar.
                    if (e?.code === "P2002") {
                        // fallback: altera levemente o salt com attempt, mantendo determinístico por tentativa
                        const bits = BigInt(5 * args.codeLen);
                        const mod = 1n << bits;
                        const x = (BigInt(u.id) * MULT + (SALT + BigInt(attempt))) % mod;
                        const fallback = encodeBase32Fixed(x, args.codeLen);

                        try {
                            await prisma.user.update({
                                where: { id: u.id },
                                data: { referralCode: fallback },
                            });
                            updated++;
                            return;
                        } catch (e2: any) {
                            if (e2?.code === "P2024") {
                                const backoff = Math.min(2000, 200 * attempt);
                                await sleep(backoff);
                                continue;
                            }
                            // cai para erro definitivo
                        }
                    }

                    // Erro definitivo
                    failed++;
                    console.error(`Failed userId=${u.id} attempt=${attempt}:`, e?.code ?? e?.message ?? e);
                    return;
                }
            }

            // se esgotou tentativas
            failed++;
            console.error(`Failed userId=${u.id}: max attempts exceeded`);
        });

        if (processed % 1000 === 0) {
            console.log(
                `Progresso: processed=${processed} updated=${updated} skipped=${skipped} failed=${failed}`
            );
        }
    }

    const remainingEnd = await prisma.user.count({ where: { referralCode: null } });
    console.log("\n=== Done ===");
    console.log({ processed, updated, skipped, failed, remainingEnd });
}

main()
    .catch((err) => {
        console.error("Fatal:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
