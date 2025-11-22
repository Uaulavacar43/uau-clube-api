# Documentação das Rotas de Pagamento

## 1. Criar Pagamento

**Endpoint:** `POST /payment`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (Body):**
```json
{
  "userId": number, // Obrigatório: ID do usuário
  "plan_id": number, // Obrigatório: ID do plano
  "cycle": "monthly" | "yearly", // Opcional: Ciclo de pagamento
  
  // Dados opcionais do cartão de crédito
  "creditCard": {
    "holderName": "string",
    "number": "string",
    "expiryMonth": "string",
    "expiryYear": "string",
    "ccv": "string"
  },
  
  // Informações do titular do cartão
  "creditCardHolderInfo": {
    "name": "string",
    "email": "string", // Deve ser um email válido
    "cpfCnpj": "string",
    "phone": "string",
    "postalCode": "string",
    "addressNumber": "string",
    "addressComplement": "string", // Opcional
    "mobilePhone": "string" // Opcional
  },
  
  "washServiceId": number // Opcional: ID do serviço de lavagem
}
```

**Resposta (201 Created):**
```json
{
  "id": number,
  "userId": number,
  "planId": number,
  "amount": number,
  "status": "string",
  "paymentMethod": "string",
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 2. Obter Histórico de Receita Anual

**Endpoint:** `GET /payment/history/yearly`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "year": number,
  "months": [
    {
      "month": number,
      "revenue": number
    }
  ]
}
```

## 3. Atualizar Status de Pagamento

**Endpoint:** `PUT /payment/update-status`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (Body):**
```json
{
  "id": number, // Obrigatório: ID do pagamento
  "status": "PAID" | "PENDING" | "CANCELED" // Obrigatório: Novo status
}
```

**Resposta (200 OK):**
```json
{
  "message": "Payment status updated successfully"
}
```

## 4. Obter Receita Total

**Endpoint:** `GET /payment/total-revenue`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "totalRevenue": number
}
```

## 5. Obter Receita do Mês Atual

**Endpoint:** `GET /payment/current-month-revenue`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "currentMonthRevenue": number
}
```

## 6. Obter Previsão de Receita para o Próximo Mês

**Endpoint:** `GET /payment/next-month-predicted-revenue`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "nextMonthPredictedRevenue": number
}
```

## 7. Obter Todos os Pagamentos com Detalhes

**Endpoint:** `GET /payment/all` ou `GET /payment/detailed-payments`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
[
  {
    "id": number,
    "userId": number,
    "planId": number,
    "amount": number,
    "status": "string",
    "paymentMethod": "string",
    "createdAt": "string",
    "updatedAt": "string",
    "user": {
      "id": number,
      "name": "string",
      "email": "string"
    },
    "plan": {
      "id": number,
      "name": "string",
      "price": number
    }
  }
]
```

## 8. Obter Detalhes de Pagamento por ID

**Endpoint:** `GET /payment/detailed-payments/:id`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `id`: ID do pagamento (number)

**Resposta (200 OK):**
```json
{
  "id": number,
  "userId": number,
  "planId": number,
  "amount": number,
  "status": "string",
  "paymentMethod": "string",
  "createdAt": "string",
  "updatedAt": "string",
  "user": {
    "id": number,
    "name": "string",
    "email": "string"
  },
  "plan": {
    "id": number,
    "name": "string",
    "price": number
  }
}
```

**Resposta (404 Not Found):**
```json
{
  "status": "error",
  "message": "Payment not found"
}
```

## 9. Obter MRR (Monthly Recurring Revenue)

**Endpoint:** `GET /payment/mrr`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "mrr": number
}
```

## 10. Webhook de Pagamento

**Endpoint:** `POST /payment/payments-webhook`

**Autenticação:** Requer token de acesso no cabeçalho

**Cabeçalhos:**
- `asaas-access-token`: Token de acesso do Asaas (deve corresponder ao token configurado no ambiente)

**Parâmetros (Body):**
Corpo do webhook conforme enviado pelo provedor de pagamento (Asaas)

**Resposta (200 OK):**
```json
{
  "success": true,
  "message": "Webhook processed successfully"
}
```

**Resposta (400 Bad Request):**
```json
{
  "status": "error",
  "message": "Invalid Asaas Access Token"
}
```

## Observações

- Todas as rotas, exceto o webhook de pagamento, requerem autenticação via `authMiddleware`.
- A rota de histórico de receita mensal está comentada no código atual.
- O webhook de pagamento requer um token de acesso específico no cabeçalho.
- Os status de pagamento válidos são "PAID", "PENDING" e "CANCELED".
- A validação dos dados é feita usando a biblioteca Zod através dos schemas definidos.
- As respostas de erro seguem o padrão de erro da aplicação (AppError).
- O MRR (Monthly Recurring Revenue) representa a receita recorrente mensal do negócio.
- As rotas `/payment/all` e `/payment/detailed-payments` são equivalentes e retornam os mesmos dados.
