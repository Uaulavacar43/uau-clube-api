# Documentação das Rotas de Notificação

## 1. Listar Notificações

**Endpoint:** `GET /notification/list`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
[
  {
    "id": number,
    "title": "string",
    "description": "string",
    "type": "USER" | "MANAGER" | "ALL",
    "isAutomatic": boolean,
    "createdAt": "string",
    "updatedAt": "string"
  }
]
```

## 2. Enviar Notificação

**Endpoint:** `POST /notification/send`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (Body):**
```json
{
  "title": "string", // Obrigatório: Título da notificação (mínimo 3 caracteres)
  "description": "string", // Obrigatório: Descrição da notificação (mínimo 5 caracteres)
  "type": "USER" | "MANAGER" | "ALL", // Obrigatório: Tipo de destinatário da notificação
  "isAutomatic": boolean // Opcional: Indica se é uma notificação automática
}
```

**Resposta (201 Created):**
```json
{
  "id": number,
  "title": "string",
  "description": "string",
  "type": "USER" | "MANAGER" | "ALL",
  "isAutomatic": boolean,
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 3. Notificar Status de Pagamento

**Endpoint:** `POST /notification/notify-payment-status`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "message": "Notificações de status de pagamento enviadas com sucesso."
}
```

**Descrição:**
Esta rota envia notificações automáticas para usuários com pagamentos pendentes. Não é necessário enviar parâmetros, pois o sistema identifica automaticamente os usuários que devem receber a notificação com base no status de seus pagamentos.

## 4. Notificar Vencimento Próximo de Assinatura

**Endpoint:** `POST /notification/notify-upcoming-expiry`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "message": "Notificações de assinatura próxima ao vencimento enviadas com sucesso."
}
```

**Descrição:**
Esta rota envia notificações automáticas para usuários cujas assinaturas estão próximas do vencimento. Não é necessário enviar parâmetros, pois o sistema identifica automaticamente os usuários que devem receber a notificação com base nas datas de vencimento de suas assinaturas.

## 5. Enviar Notificações Automáticas

**Endpoint:** `POST /notification/send-automatic`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "message": "Notificações automáticas enviadas com sucesso."
}
```

**Descrição:**
Esta rota combina as funcionalidades das rotas 3 e 4, enviando notificações tanto para usuários com pagamentos pendentes quanto para aqueles com assinaturas próximas do vencimento. Não é necessário enviar parâmetros, pois o sistema identifica automaticamente os usuários que devem receber as notificações.

## Observações

- Todas as rotas requerem autenticação via `authMiddleware`.
- As notificações podem ser direcionadas para usuários comuns ("USER"), gerentes ("MANAGER") ou todos os usuários ("ALL").
- As rotas de notificação automática não requerem parâmetros, pois o sistema identifica automaticamente os destinatários com base em regras de negócio.
- O título da notificação deve ter pelo menos 3 caracteres.
- A descrição da notificação deve ter pelo menos 5 caracteres.
- As respostas de erro seguem o padrão de erro da aplicação (AppError).
- As notificações automáticas são marcadas com `isAutomatic: true` para diferenciá-las das notificações manuais.
