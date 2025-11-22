# Documentação das Rotas de Carros de Usuário

## 1. Registrar Carro do Usuário

**Endpoint:** `POST /userCar`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (Body):**
```json
{
  "licensePlate": "string", // Obrigatório: Placa do veículo
  "color": "string", // Obrigatório: Cor do veículo
  "model": "string", // Obrigatório: Modelo do veículo
  "brand": "string", // Obrigatório: Marca do veículo
  "year": number, // Obrigatório: Ano do veículo (entre 1900 e o ano atual)
  "type": "string" // Obrigatório: Tipo do veículo
}
```

**Resposta (201 Created):**
```json
{
  "id": number,
  "licensePlate": "string",
  "color": "string",
  "model": "string",
  "brand": "string",
  "year": number,
  "type": "string",
  "userId": number,
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 2. Listar Carros do Usuário Autenticado

**Endpoint:** `GET /userCar`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
[
  {
    "id": number,
    "licensePlate": "string",
    "color": "string",
    "model": "string",
    "brand": "string",
    "year": number,
    "type": "string",
    "userId": number,
    "createdAt": "string",
    "updatedAt": "string"
  }
]
```

## 3. Atualizar Carro

**Endpoint:** `PUT /userCar/:id`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `id`: ID do carro (number)

**Parâmetros (Body):**
```json
{
  "licensePlate": "string", // Opcional: Nova placa
  "color": "string", // Opcional: Nova cor
  "model": "string", // Opcional: Novo modelo
  "brand": "string", // Opcional: Nova marca
  "year": number, // Opcional: Novo ano
  "type": "string" // Opcional: Novo tipo
}
```

**Resposta (200 OK):**
```json
{
  "id": number,
  "licensePlate": "string",
  "color": "string",
  "model": "string",
  "brand": "string",
  "year": number,
  "type": "string",
  "userId": number,
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 4. Excluir Carro

**Endpoint:** `DELETE /userCar/:id`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `id`: ID do carro (number)

**Resposta (204 No Content):**
Sem conteúdo no corpo da resposta.

## 5. Listar Carros por ID de Usuário

**Endpoint:** `GET /userCar/user/:userId`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `userId`: ID do usuário (number)

**Resposta (200 OK):**
```json
[
  {
    "id": number,
    "licensePlate": "string",
    "color": "string",
    "model": "string",
    "brand": "string",
    "year": number,
    "type": "string",
    "userId": number,
    "createdAt": "string",
    "updatedAt": "string"
  }
]
```

## Observações

- Todas as rotas requerem autenticação via `authMiddleware`.
- O ID do usuário é automaticamente obtido do token de autenticação para as operações de criação e listagem.
- Para atualizar ou excluir um carro, o usuário deve ser o proprietário do veículo.
- A rota de listagem por ID de usuário permite que administradores ou o próprio usuário visualizem os carros de um usuário específico.
