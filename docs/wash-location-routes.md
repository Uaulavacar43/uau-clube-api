# Documentação das Rotas de Wash Location

## 1. Registrar uma Nova Localização de Lavagem

**Endpoint:** `POST /`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (Body):**
```json
{
  "name": "string", // Obrigatório: Nome da localização
  "images": ["string"], // Obrigatório: Array com pelo menos uma URL de imagem
  "street": "string", // Obrigatório: Nome da rua
  "number": "string", // Obrigatório: Número do endereço
  "neighborhood": "string", // Obrigatório: Bairro
  "city": "string", // Obrigatório: Cidade
  "phoneNumber": "string", // Opcional: Número de telefone
  "managerId": number, // Obrigatório: ID do gerente responsável
  "flow": "LOW" | "MODERATE" | "HIGH" // Opcional: Fluxo de clientes (padrão: "LOW")
}
```

**Resposta (201 Created):**
```json
{
  "id": number,
  "name": "string",
  "images": ["string"],
  "street": "string",
  "number": "string",
  "neighborhood": "string",
  "city": "string",
  "phoneNumber": "string",
  "managerId": number,
  "flow": "LOW" | "MODERATE" | "HIGH",
  "createdAt": "string",
  "updatedAt": "string"
}
```

## 2. Listar Todas as Localizações de Lavagem

**Endpoint:** `GET /`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros:** Nenhum

**Resposta (200 OK):**
```json
[
  {
    "id": number,
    "name": "string",
    "images": ["string"],
    "street": "string",
    "number": "string",
    "neighborhood": "string",
    "city": "string",
    "phoneNumber": "string",
    "managerId": number,
    "flow": "LOW" | "MODERATE" | "HIGH",
    "services": [
      {
        "id": number,
        "name": "string",
        "isAvailable": boolean
      }
    ],
    "openingHours": [
      {
        "dayOfWeek": "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY",
        "openTime": "string",
        "closeTime": "string"
      }
    ],
    "createdAt": "string",
    "updatedAt": "string"
  }
]
```

## 3. Atualizar Disponibilidade de Serviço

**Endpoint:** `PUT /service-availability/:locationId/:serviceId`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `locationId`: ID da localização (number)
- `serviceId`: ID do serviço (number)

**Parâmetros (Body):**
```json
{
  "isAvailable": boolean // Obrigatório: Status de disponibilidade do serviço
}
```

**Resposta (200 OK):**
```json
{
  "id": number,
  "name": "string",
  "services": [
    {
      "id": number,
      "name": "string",
      "isAvailable": boolean
    }
  ],
  // Outros dados da localização
}
```

## 4. Atualizar Fluxo de Clientes

**Endpoint:** `PUT /flow/:locationId`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `locationId`: ID da localização (number)

**Parâmetros (Body):**
```json
{
  "flow": "LOW" | "MODERATE" | "HIGH" // Obrigatório: Novo status de fluxo
}
```

**Resposta (200 OK):**
```json
{
  "id": number,
  "name": "string",
  "flow": "LOW" | "MODERATE" | "HIGH",
  // Outros dados da localização
}
```

## 5. Atualizar Horários de Funcionamento

**Endpoint:** `PUT /opening-hours/:locationId`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (URL):**
- `locationId`: ID da localização (number)

**Parâmetros (Body):**
```json
{
  "openingHours": [
    {
      "dayOfWeek": "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY", // Obrigatório: Dia da semana
      "openTime": "string", // Obrigatório: Horário de abertura (formato: HH:MM)
      "closeTime": "string" // Obrigatório: Horário de fechamento (formato: HH:MM)
    }
  ]
}
```

**Resposta (200 OK):**
```json
{
  "id": number,
  "name": "string",
  "openingHours": [
    {
      "dayOfWeek": "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY",
      "openTime": "string",
      "closeTime": "string"
    }
  ],
  // Outros dados da localização
}
```

## 6. Listar Localizações por Gerente

**Endpoint:** `GET /by-manager/:managerId`

**Autenticação:** Não requerida

**Parâmetros (URL):**
- `managerId`: ID do gerente (number)

**Resposta (200 OK):**
```json
[
  {
    "id": number,
    "name": "string",
    "images": ["string"],
    "street": "string",
    "number": "string",
    "neighborhood": "string",
    "city": "string",
    "phoneNumber": "string",
    "managerId": number,
    "flow": "LOW" | "MODERATE" | "HIGH",
    // Outros dados da localização
  }
]
```

## Observações

- Todas as rotas, exceto a última, requerem autenticação via `authMiddleware`.
- Os DTOs são validados usando a biblioteca Zod.
- As respostas de erro seguem o padrão de erro da aplicação (AppError).
