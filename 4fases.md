Perfeito. Com o **schema OK**, **migrations aplicadas** e o **backfill rodando**, o próximo passo para chegarmos até a **Fase 4** é seguir uma ordem que evite retrabalho e duplicidade (webhook/retry/cron).

Criei o documento **“UAU+ Backend — Plano Técnico até a Fase 4 (Indicação, Bônus 3 níveis e Float)”** no canvas, com checklist e padrões (idempotência/eventKey, fluxos e endpoints).

## Próximo passo imediato (agora)

### 1) Validar que o backfill terminou e ficou consistente

Rode estes checks no Postgres:

```sql
-- 1) Quantos users ainda sem referralCode?
SELECT COUNT(*) AS sem_code
FROM public."User"
WHERE "referralCode" IS NULL;

-- 2) Checar duplicidade (deve ser 0)
SELECT "referralCode", COUNT(*)
FROM public."User"
WHERE "referralCode" IS NOT NULL
GROUP BY 1
HAVING COUNT(*) > 1
LIMIT 20;
```

Se `sem_code = 0` e sem duplicatas: fechamos o pré-requisito da Fase 1.

### 2) Garantir geração de referralCode em novos cadastros

Hoje o campo está **nullable** (correto para base legada). Agora precisamos **gerar no register** (AuthService) para novos usuários.

Regra recomendada:

* se o frontend não mandar `referralCode`, o backend gera;
* se mandar, **ignorar** e sempre gerar internamente (evita fraude).
* deixar o campo nullable por enquanto; depois você pode tornar obrigatório quando estiver 100%.

### 3) Fase 1: vínculo de indicação no cadastro

No `POST /auth/register`:

* aceitar `referralCode` do indicador (opcional)
* resolver `referrerId` via `User.referralCode`
* validar:

    * não pode ser o próprio usuário
    * usuário não pode já ter `referrerId`
* persistir:

    * `User.referrerId = referrer.id`
    * criar `UserReferral` (auditoria/antifraude: ip, userAgent, deviceId, source)

## Para Fase 2 e 3 (bônus) você precisa ajustar schema sim

O seu schema atual **funciona**, mas para produção você precisa de **idempotência** (senão bônus duplica).

Ajustes mínimos:

1. `ReferralBonus`: adicionar `eventKey String @unique`
2. `CashbackTransaction`: adicionar `eventKey String @unique` e `meta Json?`

Padrão de `eventKey`:

* Único: `UNIQUE:payment:{paymentIdAsaas}:{level}:{receiverId}`
* Recorrente: `RECURRENT:{YYYY-MM}:payer:{payerId}:level:{level}:receiver:{receiverId}`

Depois disso:

* **Fase 2**: gatilho em `PaymentStatus=PAID` gera bônus N1/N2/N3
* **Fase 3**: cron mensal por competência gera bônus recorrente, respeitando elegibilidade

## Para Fase 4 (float) precisa ajustar Payment

Adicionar no `Payment`:

* `channel` (PIX | CARD | UNKNOWN)
* `paidAt`, `expectedSettlementAt`, `settledAt`
* `feeAmount`, `netAmount` (quando houver)

A partir disso:

* Float aberto = `paidAt IS NOT NULL AND settledAt IS NULL`
* Endpoints de consulta/summary para dashboard

Se você quiser, na próxima mensagem eu já te devolvo:

1. a **migração Prisma** completa de `eventKey` + campos de float, e
2. o **esqueleto do módulo referrals** (use-case do bônus único e cron do recorrente) seguindo exatamente o que está no documento.
