# Documentação da Rota de Lavagem Diária

## Utilizar Lavagem Diária

**Endpoint:** `POST /dailyWash/use`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (Body):**
```json
{
  "licensePlate": "string", // Obrigatório: Placa do veículo
  "washServiceId": number // Opcional: ID do serviço de lavagem avulso (para uso adicional)
}
```

**Resposta (201 Created):**
```json
{
  "id": number,
  "carId": number,
  "date": "string", // Data da lavagem no formato ISO
  "createdAt": "string",
  "updatedAt": "string"
}
```

**Possíveis Erros:**

| Código | Mensagem | Descrição |
|--------|----------|-----------|
| 400 | "A placa do veículo é obrigatória" | Quando a placa não é informada no corpo da requisição |
| 400 | "Não existe uma assinatura ativa para este carro." | Quando o veículo não possui uma assinatura ativa |
| 400 | "Já foi utilizado o lava rápido diário; nenhum serviço avulso foi informado." | Quando já foi utilizada a lavagem diária e não foi informado um serviço avulso para uso adicional |
| 400 | "Não existe um serviço avulso COMPLETED disponível para uso." | Quando o serviço avulso informado não existe ou não está com status COMPLETED |

## Descrição

Esta rota permite que um usuário utilize o serviço de lavagem diária incluído em sua assinatura. O sistema verifica se o veículo possui uma assinatura ativa e se já foi utilizada a lavagem diária para o dia atual.

### Regras de Negócio

1. **Verificação de Assinatura:**
   - O sistema verifica se existe uma assinatura ativa para o veículo com a placa informada.
   - Se não existir uma assinatura ativa, a requisição é rejeitada.

2. **Verificação de Uso Diário:**
   - O sistema verifica se o veículo já utilizou a lavagem diária na data atual.
   - Se já foi utilizada, existem duas possibilidades:
     - Se não for informado um `washServiceId`, a requisição é rejeitada.
     - Se for informado um `washServiceId`, o sistema verifica se o usuário possui um serviço avulso disponível.

3. **Uso de Serviço Avulso:**
   - Quando o usuário já utilizou a lavagem diária, ele pode usar um serviço avulso adquirido previamente.
   - O serviço avulso deve estar com status "COMPLETED" para ser utilizado.
   - Após o uso, o status do serviço avulso é alterado para "CANCELED".

## Exemplo de Uso

### Primeira Lavagem do Dia:

**Requisição:**
```json
{
  "licensePlate": "ABC1234"
}
```

**Resposta (201 Created):**
```json
{
  "id": 123,
  "carId": 456,
  "date": "2025-03-19T00:00:00.000Z",
  "createdAt": "2025-03-19T14:30:00.000Z",
  "updatedAt": "2025-03-19T14:30:00.000Z"
}
```

### Lavagem Adicional (usando serviço avulso):

**Requisição:**
```json
{
  "licensePlate": "ABC1234",
  "washServiceId": 789
}
```

**Resposta (201 Created):**
```json
{
  "id": 124,
  "carId": 456,
  "date": "2025-03-19T00:00:00.000Z",
  "createdAt": "2025-03-19T16:45:00.000Z",
  "updatedAt": "2025-03-19T16:45:00.000Z"
}
```

## Observações

- A rota de verificação de disponibilidade (`/availability/:carId`) está comentada no código atual.
- O sistema permite apenas uma lavagem diária por veículo, a menos que seja utilizado um serviço avulso.
- O serviço avulso é consumido (status alterado para "CANCELED") após o uso.
- A autenticação é obrigatória para esta rota.
- A validação dos dados é feita usando a biblioteca Zod através do schema `RegisterDailyWashSchema`.
- As respostas de erro seguem o padrão de erro da aplicação (AppError).
