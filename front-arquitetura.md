
# 📱 UAU+ — Frontend Ionic + Angular 19

## README Técnico — Cashback & Indicação

Frontend responsável pela **experiência financeira** do UAU+, cobrindo:

* Cashback
* Indicação (Referral)
* Extratos
* Operação/Admin
* Preparado para **Fase 4 (Float)**

⚠️ **Nenhuma regra de negócio vive aqui**
⚠️ **Todo cálculo, validação e consistência são externos ao front**

---

## 🧱 Stack & Padrões

* **Angular 19**
* **Ionic**
* Standalone Components (default do Angular 19)
* `app.routes.ts` único
* Pages com `.page.ts + .html + .scss`
* SCSS por page e por component
* Guards simples
* Services como *data providers*
* Tipagem explícita (models)

---

# 🗺️ CONTAGEM FINAL DE TELAS

| Contexto                       | Pages        |
| ------------------------------ | ------------ |
| Público (aquisição)            | 1            |
| Usuário (cashback & indicação) | 5            |
| Admin / Operação               | 5            |
| **TOTAL**                      | **11 PAGES** |

---

# 🧭 USER JOURNEY (FLUXO DE NAVEGAÇÃO)

## Jornada 1 — Aquisição (Usuário Convidado)

```
Link de convite
 → Landing de Download
 → Instalação do App
```

### Page

* `DownloadPage`

Função:

* Explicar benefício
* Direcionar para download
* Nenhuma navegação interna

---

## Jornada 2 — Usuário Logado (Financeiro)

Entrada:

```
Flutter App → Aba Cashback → Ionic (WebView)
```

Fluxo:

```
Cashback Dashboard
 ├─ Extrato de Cashback
 └─ Indique & Ganhe
      ├─ Minhas Indicações
      └─ Extrato de Bônus
```

Saída:

* Voltar → fecha WebView → retorna ao Flutter

---

## Jornada 3 — Admin / Operação

Entrada direta no Ionic (fora do Flutter).

Fluxo:

```
Admin Dashboard
 ├─ Cashback Global
 ├─ Indicações / Bônus
 ├─ Pagamentos & Float
 └─ Detalhe de Pagamento
```

---

# 📁 ESTRUTURA FINAL DE PASTAS (ANGULAR 19)

```
src/app
├── app.component.ts
├── app.component.html
├── app.component.scss
├── app.routes.ts
│
├── guards
│   ├── auth.guard.ts
│   └── admin.guard.ts
│
├── services
│   ├── cashback.service.ts
│   ├── referral.service.ts
│   └── admin.service.ts
│
├── models
│   ├── cashback-wallet-summary.model.ts
│   ├── cashback-transaction.model.ts
│   ├── referral-summary.model.ts
│   ├── referral-item.model.ts
│   ├── referral-bonus.model.ts
│   ├── admin-cashback-summary.model.ts
│   ├── admin-referral-bonus.model.ts
│   └── payment-float.model.ts
│
├── shared
│   ├── page-header
│   │   ├── page-header.component.ts
│   │   ├── page-header.component.html
│   │   └── page-header.component.scss
│   │
│   ├── balance-card
│   │   ├── balance-card.component.ts
│   │   ├── balance-card.component.html
│   │   └── balance-card.component.scss
│   │
│   ├── info-card
│   │   ├── info-card.component.ts
│   │   ├── info-card.component.html
│   │   └── info-card.component.scss
│   │
│   ├── list-item
│   │   ├── list-item.component.ts
│   │   ├── list-item.component.html
│   │   └── list-item.component.scss
│   │
│   ├── status-badge
│   │   ├── status-badge.component.ts
│   │   ├── status-badge.component.html
│   │   └── status-badge.component.scss
│   │
│   └── empty-state
│       ├── empty-state.component.ts
│       ├── empty-state.component.html
│       └── empty-state.component.scss
│
├── pages
│   ├── public-download
│   │   ├── download.page.ts
│   │   ├── download.page.html
│   │   └── download.page.scss
│   │
│   ├── cashback-dashboard
│   │   ├── cashback-dashboard.page.ts
│   │   ├── cashback-dashboard.page.html
│   │   └── cashback-dashboard.page.scss
│   │
│   ├── cashback-extract
│   │   ├── cashback-extract.page.ts
│   │   ├── cashback-extract.page.html
│   │   └── cashback-extract.page.scss
│   │
│   ├── referral-dashboard
│   │   ├── referral-dashboard.page.ts
│   │   ├── referral-dashboard.page.html
│   │   └── referral-dashboard.page.scss
│   │
│   ├── referral-list
│   │   ├── referral-list.page.ts
│   │   ├── referral-list.page.html
│   │   └── referral-list.page.scss
│   │
│   ├── referral-bonuses
│   │   ├── referral-bonuses.page.ts
│   │   ├── referral-bonuses.page.html
│   │   └── referral-bonuses.page.scss
│   │
│   ├── admin-dashboard
│   │   ├── admin-dashboard.page.ts
│   │   ├── admin-dashboard.page.html
│   │   └── admin-dashboard.page.scss
│   │
│   ├── admin-cashback
│   │   ├── admin-cashback.page.ts
│   │   ├── admin-cashback.page.html
│   │   └── admin-cashback.page.scss
│   │
│   ├── admin-referrals
│   │   ├── admin-referrals.page.ts
│   │   ├── admin-referrals.page.html
│   │   └── admin-referrals.page.scss
│   │
│   ├── admin-payments-float
│   │   ├── admin-payments-float.page.ts
│   │   ├── admin-payments-float.page.html
│   │   └── admin-payments-float.page.scss
│   │
│   └── admin-payment-detail
│       ├── admin-payment-detail.page.ts
│       ├── admin-payment-detail.page.html
│       └── admin-payment-detail.page.scss
```

---

# 🧩 COMPONENTES SHARED (TODOS)

| Componente             | Responsabilidade      |
| ---------------------- | --------------------- |
| `PageHeaderComponent`  | Título + botão voltar |
| `BalanceCardComponent` | Exibição de saldo     |
| `InfoCardComponent`    | Métrica simples       |
| `ListItemComponent`    | Item padrão de lista  |
| `StatusBadgeComponent` | Status visual         |
| `EmptyStateComponent`  | Estado vazio (UX)     |

Todos são **standalone** (`standalone: true`).

---

# 🧠 SERVICES (SRP — SEM REGRA)

* `CashbackService`
* `ReferralService`
* `AdminService`

Responsabilidade:

* Buscar dados
* Retornar observables
* Nenhuma lógica

---

# 📦 MODELS (TIPAGEM)

* Cashback:

    * `CashbackWalletSummary`
    * `CashbackTransaction`
* Referral:

    * `ReferralSummary`
    * `ReferralItem`
    * `ReferralBonus`
* Admin:

    * `AdminCashbackSummary`
    * `AdminReferralBonus`
    * `PaymentFloat`

---

# 🧭 ROUTING — `app.routes.ts` (ÚNICO)

* `/download`
* `/cashback`
* `/cashback/extract`
* `/referral`
* `/referral/list`
* `/referral/bonuses`
* `/admin`
* `/admin/cashback`
* `/admin/referrals`
* `/admin/payments/float`
* `/admin/payments/:id`

Com guards aplicados diretamente na rota.

---

# 🚫 O FRONT NÃO FAZ

* Não calcula valores
* Não cria bônus
* Não valida regras
* Não infere status
* Não cria eventos
* Não depende do Flutter

---

# ✅ O FRONT FAZ

* Renderiza dados
* Controla navegação
* Garante UX clara
* Organiza informação financeira
* Prepara migração futura

---

# 🔁 MIGRAÇÃO FUTURA

Quando Flutter sair:

* Ionic vira app principal
* Login próprio é adicionado
* Nenhuma page, service ou model muda

---

