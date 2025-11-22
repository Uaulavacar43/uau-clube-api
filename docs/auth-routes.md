# Documentação das Rotas de Autenticação

## Registro de Usuário

**Endpoint:** `POST /auth/register`

**Autenticação:** Não requerida

**Parâmetros (Body):**
```json
{
  "name": "string", // Obrigatório: Nome completo do usuário
  "email": "string", // Obrigatório: Email válido
  "password": "string", // Obrigatório: Senha (mínimo 6 caracteres)
  "phone": "string", // Obrigatório: Número de telefone
  "cpf": "string", // Obrigatório: CPF válido
  "role": "USER" | "ADMIN", // Obrigatório: Papel do usuário
  "firebaseToken": "string" // Opcional: Token do Firebase para notificações push
}
```

**Resposta (201 Created):**
```json
{
  "token": "string", // Token JWT de acesso (válido por 15 minutos)
  "refreshToken": "string", // Token JWT de atualização (válido por 3 dias)
  "user": {
    "id": number,
    "name": "string",
    "email": "string",
    "phone": "string",
    "cpf": "string",
    "role": "USER" | "ADMIN",
    "createdAt": "string",
    "updatedAt": "string"
  }
}
```

**Possíveis Erros:**

| Código | Mensagem | Descrição |
|--------|----------|-----------|
| 400 | "CPF inválido" | Quando o CPF fornecido não é válido |
| 400 | "E-mail já registrado" | Quando o email já está em uso por outro usuário |
| 400 | "CPF já registrado" | Quando o CPF já está em uso por outro usuário |

## Login de Usuário

**Endpoint:** `POST /auth/login`

**Autenticação:** Não requerida

**Parâmetros (Body):**
```json
{
  "email": "string", // Obrigatório: Email do usuário
  "password": "string", // Obrigatório: Senha do usuário
  "firebaseToken": "string" // Opcional: Token do Firebase para notificações push
}
```

**Resposta (200 OK):**
```json
{
  "token": "string", // Token JWT de acesso (válido por 15 minutos)
  "refreshToken": "string", // Token JWT de atualização (válido por 3 dias)
  "user": {
    "id": number,
    "name": "string",
    "email": "string",
    "phone": "string",
    "cpf": "string",
    "role": "USER" | "ADMIN",
    "createdAt": "string",
    "updatedAt": "string"
  }
}
```

**Possíveis Erros:**

| Código | Mensagem | Descrição |
|--------|----------|-----------|
| 401 | "Credenciais inválidas" | Quando o email não existe ou a senha está incorreta |

## Obter Token do Firebase

**Endpoint:** `GET /auth/firebase-token/:id`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `id` (number): ID do usuário para o qual deseja obter os tokens do Firebase

**Resposta (200 OK):**
```json
{
  "firebaseToken": ["string"] // Array de tokens do Firebase associados ao usuário
}
```

**Possíveis Erros:**

| Código | Mensagem | Descrição |
|--------|----------|-----------|
| 404 | "Nenhum token do Firebase encontrado para este usuário" | Quando não há tokens registrados para o usuário |

## Atualizar Token de Acesso

**Endpoint:** `POST /auth/refresh-token`

**Autenticação:** Não requerida

**Parâmetros (Body):**
```json
{
  "refreshToken": "string" // Obrigatório: Token de atualização válido
}
```

**Resposta (200 OK):**
```json
{
  "token": "string", // Novo token JWT de acesso (válido por 15 minutos)
  "refreshToken": "string" // Novo token JWT de atualização (válido por 3 dias)
}
```

**Possíveis Erros:**

| Código | Mensagem | Descrição |
|--------|----------|-----------|
| 401 | "Refresh token inválido ou expirado" | Quando o token de atualização é inválido ou expirou |
| 404 | "Usuário não encontrado" | Quando o usuário associado ao token não existe mais |

## Descrição

As rotas de autenticação permitem o registro de novos usuários, login de usuários existentes, obtenção de tokens do Firebase para notificações push e atualização de tokens de acesso expirados.

### Fluxo de Autenticação

1. **Registro**: Um novo usuário se registra fornecendo seus dados pessoais.
2. **Login**: Um usuário registrado faz login com email e senha.
3. **Uso de APIs Protegidas**: O usuário usa o token JWT recebido para acessar rotas protegidas.
4. **Atualização de Token**: Quando o token de acesso expira, o usuário usa o refresh token para obter um novo par de tokens.

### Segurança

- Os tokens de acesso têm validade de 15 minutos.
- Os tokens de atualização têm validade de 3 dias.
- As senhas são armazenadas de forma segura utilizando hash.
- O CPF é validado para garantir que seja um número válido.
- Emails duplicados não são permitidos.
- CPFs duplicados não são permitidos.

### Tokens do Firebase

Os tokens do Firebase são utilizados para enviar notificações push para os dispositivos dos usuários. Um usuário pode ter múltiplos tokens associados (por exemplo, um para cada dispositivo).

## Exemplos de Uso

### Registro de Usuário

**Requisição:**
```json
{
  "name": "João Silva",
  "email": "joao.silva@exemplo.com",
  "password": "senha123",
  "phone": "11999887766",
  "cpf": "12345678909",
  "role": "USER",
  "firebaseToken": "firebase-token-123"
}
```

### Login de Usuário

**Requisição:**
```json
{
  "email": "joao.silva@exemplo.com",
  "password": "senha123",
  "firebaseToken": "firebase-token-456"
}
```

### Atualização de Token

**Requisição:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

## Observações

- A rota de registro envia um email de boas-vindas para o usuário recém-registrado.
- O token do Firebase é opcional no registro e login, mas é recomendado para receber notificações push.
- O token de acesso deve ser incluído no cabeçalho de autorização das requisições para rotas protegidas no formato: `Authorization: Bearer {token}`.
- Para segurança adicional, é recomendado armazenar o refresh token em um cookie HTTP-only no cliente.
