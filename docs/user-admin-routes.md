# Documentação das Rotas de Administração de Usuários

## 1. Criar Usuário

**Endpoint:** `POST /userAdmin`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas administradores

**Parâmetros (Body):**
```json
{
  "name": "string", // Obrigatório: Nome do usuário
  "email": "string", // Obrigatório: Email válido (será convertido para minúsculas)
  "password": "string", // Obrigatório: Senha do usuário
  "phone": "string", // Opcional: Telefone do usuário
  "role": "USER" | "ADMIN" | "MANAGER" // Obrigatório: Papel do usuário
}
```

**Resposta (201 Created):**
```json
{
  "id": number,
  "name": "string",
  "email": "string",
  "phone": "string",
  "role": "USER" | "ADMIN" | "MANAGER",
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 2. Atualizar Usuário

**Endpoint:** `PUT /userAdmin/:id`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas administradores

**Parâmetros (URL):**
- `id`: ID do usuário a ser atualizado (number)

**Parâmetros (Body):**
```json
{
  "name": "string", // Opcional: Novo nome
  "email": "string", // Opcional: Novo email válido (será convertido para minúsculas)
  "password": "string", // Opcional: Nova senha
  "phone": "string", // Opcional: Novo telefone
  "role": "USER" | "ADMIN" | "MANAGER" // Opcional: Novo papel
}
```

**Resposta (200 OK):**
```json
{
  "id": number,
  "name": "string",
  "email": "string",
  "phone": "string",
  "role": "USER" | "ADMIN" | "MANAGER",
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 3. Excluir Usuário

**Endpoint:** `DELETE /userAdmin/:id`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas administradores

**Parâmetros (URL):**
- `id`: ID do usuário a ser excluído (number)

**Resposta (204 No Content):**
Sem conteúdo no corpo da resposta.

## 4. Obter Usuário por ID

**Endpoint:** `GET /userAdmin/:id`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas administradores

**Parâmetros (URL):**
- `id`: ID do usuário a ser obtido (number)

**Resposta (200 OK):**
```json
{
  "id": number,
  "name": "string",
  "email": "string",
  "phone": "string",
  "role": "USER" | "ADMIN" | "MANAGER",
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 5. Obter Usuários por Papel

**Endpoint:** `GET /userAdmin/role/:role`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas administradores

**Parâmetros (URL):**
- `role`: Papel dos usuários a serem obtidos ("USER", "ADMIN" ou "MANAGER")

**Parâmetros (Query):**
- `page`: Número da página (opcional, padrão: 1)
- `pageSize`: Tamanho da página (opcional, padrão: 10)

**Resposta (200 OK):**
```json
{
  "users": [
    {
      "id": number,
      "name": "string",
      "email": "string",
      "phone": "string",
      "role": "USER" | "ADMIN" | "MANAGER",
      "createdAt": "string",
      "updatedAt": "string"
    }
  ],
  "total": number,
  "page": number,
  "pageSize": number
}
```

## 6. Contar Todos os Usuários

**Endpoint:** `GET /userAdmin/count/all`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas administradores

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "totalUsers": number
}
```

## 7. Contar Assinantes Ativos

**Endpoint:** `GET /userAdmin/count/active-subscribers`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas administradores

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
{
  "activeSubscribers": number
}
```

## 8. Listar Todos os Usuários

**Endpoint:** `GET /userAdmin`

**Autenticação:** Requerida (authMiddleware)

**Permissão:** Apenas administradores

**Parâmetros (Query):**
- `page`: Número da página (opcional, padrão: 1)
- `pageSize`: Tamanho da página (opcional, padrão: 10)

**Resposta (200 OK):**
```json
{
  "users": [
    {
      "id": number,
      "name": "string",
      "email": "string",
      "phone": "string",
      "role": "USER" | "ADMIN" | "MANAGER",
      "createdAt": "string",
      "updatedAt": "string"
    }
  ],
  "total": number,
  "currentPage": number,
  "totalPages": number
}
```

## Observações

- Todas as rotas requerem autenticação via `authMiddleware`.
- Estas rotas são destinadas apenas a usuários com permissão de administrador.
- Os DTOs são validados usando a biblioteca Zod.
- As respostas de erro seguem o padrão de erro da aplicação (AppError).
- Várias rotas suportam paginação através de parâmetros de consulta.
