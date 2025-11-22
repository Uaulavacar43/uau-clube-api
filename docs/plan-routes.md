# Documentação das Rotas de Planos

## 1. Criar Plano

**Endpoint:** `POST /plans`

**Autenticação:** Não requerida

**Parâmetros (Body):**
```json
{
  "name": "string", // Obrigatório: Nome do plano (não pode ser vazio)
  "price": number, // Obrigatório: Preço do plano (deve ser positivo)
  "duration": number // Obrigatório: Duração do plano em dias (deve ser um inteiro positivo)
}
```

**Resposta (201 Created):**
```json
{
  "id": number,
  "name": "string",
  "price": number,
  "duration": number,
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 2. Listar Todos os Planos

**Endpoint:** `GET /plans`

**Autenticação:** Não requerida

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
[
  {
    "id": number,
    "name": "string",
    "price": number,
    "duration": number,
    "createdAt": "string",
    "updatedAt": "string"
  }
]
```

## 3. Buscar Plano por ID

**Endpoint:** `GET /plans/:id`

**Autenticação:** Não requerida

**Parâmetros (URL):**
- `id`: ID do plano (number)

**Resposta (200 OK):**
```json
{
  "id": number,
  "name": "string",
  "price": number,
  "duration": number,
  "createdAt": "string",
  "updatedAt": "string"
}
```

**Resposta (404 Not Found):**
```json
{
  "status": "error",
  "message": "Plano não encontrado"
}
```

## 4. Atualizar Plano

**Endpoint:** `PUT /plans/:id`

**Autenticação:** Não requerida

**Parâmetros (URL):**
- `id`: ID do plano (number)

**Parâmetros (Body):**
```json
{
  "name": "string", // Opcional: Novo nome do plano
  "price": number, // Opcional: Novo preço (deve ser positivo)
  "duration": number // Opcional: Nova duração em dias (deve ser um inteiro positivo)
}
```

**Resposta (200 OK):**
```json
{
  "id": number,
  "name": "string",
  "price": number,
  "duration": number,
  "createdAt": "string",
  "updatedAt": "string"
}
```

**Resposta (404 Not Found):**
```json
{
  "status": "error",
  "message": "Plano não encontrado"
}
```

## 5. Excluir Plano

**Endpoint:** `DELETE /plans/:id`

**Autenticação:** Não requerida

**Parâmetros (URL):**
- `id`: ID do plano (number)

**Resposta (204 No Content):**
Sem conteúdo no corpo da resposta.

**Resposta (404 Not Found):**
```json
{
  "status": "error",
  "message": "Plano não encontrado"
}
```

## Observações

- Diferente de outras rotas da API, as rotas de planos não requerem autenticação.
- A validação dos dados é feita usando a biblioteca Zod através dos schemas definidos.
- O preço do plano deve ser um número positivo.
- A duração do plano é especificada em dias e deve ser um número inteiro positivo.
- As respostas de erro seguem o padrão de erro da aplicação (AppError).
- Ao tentar acessar um plano inexistente, a API retornará um erro 404.
