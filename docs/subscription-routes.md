# Documentação das Rotas de Assinatura

## 1. Registrar Assinatura

**Endpoint:** `POST /subscription`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (Body):**
```json
{
  "userId": number, // Obrigatório: ID do usuário
  "carId": number, // Obrigatório: ID do carro
  "planId": number, // Obrigatório: ID do plano
  "planType": "MONTHLY" | "ANNUAL", // Obrigatório: Tipo do plano
  "amount": number, // Obrigatório: Valor da assinatura (deve ser positivo)
  "paymentMethod": "string" // Obrigatório: Método de pagamento
}
```

**Resposta (201 Created):**
```json
{
  "id": number,
  "userId": number,
  "carId": number,
  "planId": number,
  "planType": "MONTHLY" | "ANNUAL",
  "amount": number,
  "paymentMethod": "string",
  "status": "string",
  "startDate": "string",
  "endDate": "string",
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 2. Atualizar Assinatura

**Endpoint:** `PUT /subscription/:id`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `id`: ID da assinatura a ser atualizada (number)

**Parâmetros (Body):**
```json
{
  "plan": "MONTHLY" | "ANNUAL", // Opcional: Novo tipo de plano
  "carId": number // Opcional: Novo ID do carro
}
```

**Resposta (200 OK):**
```json
{
  "id": number,
  "userId": number,
  "carId": number,
  "planId": number,
  "planType": "MONTHLY" | "ANNUAL",
  "amount": number,
  "paymentMethod": "string",
  "status": "string",
  "startDate": "string",
  "endDate": "string",
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 3. Cancelar Assinatura

**Endpoint:** `DELETE /subscription/:id`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `id`: ID da assinatura a ser cancelada (number)

**Resposta (200 OK):**
```json
{
  "message": "Assinatura cancelada com sucesso"
}
```

## Observações

- Todas as rotas requerem autenticação via `authMiddleware`.
- A rota de listagem de assinaturas está comentada no código atual.
- As assinaturas estão vinculadas a um usuário específico e a um carro específico.
- Os tipos de plano são restritos a "MONTHLY" (mensal) ou "ANNUAL" (anual).
- O valor da assinatura deve ser um número positivo.
- Ao cancelar uma assinatura, o status é alterado, mas o registro permanece no sistema.
- A validação dos dados é feita usando a biblioteca Zod através dos schemas definidos.
- As respostas de erro seguem o padrão de erro da aplicação (AppError).
