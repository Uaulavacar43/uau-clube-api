# Documentação das Rotas de Wash Service

## 1. Criar um Novo Serviço de Lavagem

**Endpoint:** `POST /`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas usuários com role ADMIN

**Parâmetros (Body):**
```json
{
  "name": "string", // Obrigatório: Nome do serviço
  "price": number, // Obrigatório: Preço do serviço (número positivo)
  "imageUrl": "string", // Opcional: URL da imagem do serviço
  "isAvailable": boolean, // Opcional: Disponibilidade do serviço (padrão: false)
  "adminId": number // Opcional: ID do administrador (será substituído pelo ID do usuário autenticado)
}
```

**Resposta (201 Created):**
```json
{
  "id": number,
  "name": "string",
  "price": number,
  "imageUrl": "string",
  "isAvailable": boolean,
  "adminId": number,
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 2. Atualizar um Serviço de Lavagem

**Endpoint:** `PUT /:id`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas usuários com role ADMIN

**Parâmetros (URL):**
- `id`: ID do serviço a ser atualizado (number)

**Parâmetros (Body):**
```json
{
  "name": "string", // Opcional: Novo nome do serviço
  "price": number, // Opcional: Novo preço do serviço (número positivo)
  "imageUrl": "string", // Opcional: Nova URL da imagem do serviço
  "isAvailable": boolean, // Opcional: Nova disponibilidade do serviço
  "adminId": number // Opcional: ID do administrador (será substituído pelo ID do usuário autenticado)
}
```

**Resposta (200 OK):**
```json
{
  "id": number,
  "name": "string",
  "price": number,
  "imageUrl": "string",
  "isAvailable": boolean,
  "adminId": number,
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 3. Excluir um Serviço de Lavagem

**Endpoint:** `DELETE /:id`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas usuários com role ADMIN

**Parâmetros (URL):**
- `id`: ID do serviço a ser excluído (number)

**Resposta (204 No Content):**
Sem conteúdo no corpo da resposta.

## 4. Listar Serviços de Lavagem com Localizações

**Endpoint:** `GET /`

**Autenticação:** Não requerida

**Parâmetros (Query):**
- `page`: Número da página (opcional, padrão: 1)
- `pageSize`: Tamanho da página (opcional, padrão: 10)

**Resposta (200 OK):**
```json
{
  "services": [
    {
      "id": number,
      "name": "string",
      "price": number,
      "imageUrl": "string",
      "isAvailable": boolean,
      "adminId": number,
      "locations": [
        {
          "id": number,
          "name": "string",
          // Outros dados da localização
        }
      ],
      "createdAt": "string",
      "updatedAt": "string"
    }
  ],
  "totalPages": number
}
```

## 5. Obter um Serviço de Lavagem por ID

**Endpoint:** `GET /:id`

**Autenticação:** Não requerida

**Parâmetros (URL):**
- `id`: ID do serviço a ser obtido (number)

**Resposta (200 OK):**
```json
{
  "id": number,
  "name": "string",
  "price": number,
  "imageUrl": "string",
  "isAvailable": boolean,
  "adminId": number,
  "locations": [
    {
      "id": number,
      "name": "string",
      // Outros dados da localização
    }
  ],
  "createdAt": "string",
  "updatedAt": "string"
}
```

## Observações

- As rotas de criação, atualização e exclusão de serviços requerem autenticação e permissão de administrador.
- Os DTOs são validados usando a biblioteca Zod.
- As respostas de erro seguem o padrão de erro da aplicação (AppError).
- A paginação está disponível na rota de listagem de serviços.
