# Documentação da Rota de Upload de Arquivos

## Gerar URL para Upload de Arquivo

**Endpoint:** `POST /fileUpload`

**Autenticação:** Requerida (authMiddleware)

**Parâmetros (Body):**
```json
{
  "name": "string", // Obrigatório: Nome do arquivo
  "mimeType": "string", // Obrigatório: Tipo MIME do arquivo (ex: "image/jpeg", "application/pdf")
  "folder": "string", // Opcional: Subpasta onde o arquivo será armazenado
  "type": "user" | "wash-service" // Obrigatório: Tipo de entidade relacionada ao arquivo
}
```

**Resposta (200 OK):**
```json
{
  "url": "string", // URL assinada para upload do arquivo (válida por 24 horas)
  "urlView": "string" // URL permanente para visualização do arquivo após o upload
}
```

## Descrição

Esta rota gera URLs pré-assinadas para upload de arquivos diretamente para o Amazon S3. O processo funciona da seguinte forma:

1. O cliente faz uma solicitação para obter uma URL pré-assinada, especificando os detalhes do arquivo.
2. A API retorna uma URL temporária para upload e uma URL permanente para visualização.
3. O cliente usa a URL temporária para fazer o upload do arquivo diretamente para o S3 (sem passar pela API).
4. Após o upload bem-sucedido, o arquivo pode ser acessado através da URL de visualização.

## Detalhes dos Parâmetros

- **name**: Nome do arquivo original. Será convertido para um formato de URL amigável (slugify).
- **mimeType**: Tipo MIME do arquivo, usado para definir o Content-Type no S3.
- **folder**: Subpasta opcional dentro do tipo especificado. Útil para organizar arquivos.
- **type**: Categoria principal do arquivo, que determina a pasta base no S3. Valores permitidos:
  - `user`: Para arquivos relacionados a usuários (ex: fotos de perfil)
  - `wash-service`: Para arquivos relacionados a serviços de lavagem (ex: imagens de serviços)

## Observações

- A URL de upload gerada é válida por 24 horas.
- O nome do arquivo é processado com slugify para remover caracteres especiais e espaços.
- Os arquivos são armazenados em pastas organizadas por ambiente (dev, homol, prod).
- A estrutura de pastas no S3 segue o padrão: `[ambiente]/[type]/[folder]/[filename]`.
- A autenticação é obrigatória para esta rota.
- Esta implementação usa o padrão de upload direto para o S3, o que reduz a carga no servidor da API.
- O tamanho máximo do arquivo é determinado pelas configurações do S3, não pela API.

## Exemplo de Uso

Para fazer upload de uma imagem de perfil de usuário:

```json
{
  "name": "foto_perfil.jpg",
  "mimeType": "image/jpeg",
  "folder": "profile",
  "type": "user"
}
```

Resposta:
```json
{
  "url": "https://s3.us-east-1.amazonaws.com/bucket-name/dev/user/profile/foto-perfil.jpg?X-Amz-Algorithm=...",
  "urlView": "https://s3.us-east-1.amazonaws.com/bucket-name/dev/user/profile/foto-perfil.jpg"
}
```

Para completar o upload, o cliente deve fazer uma requisição PUT para a URL retornada no campo `url`, incluindo o arquivo no corpo da requisição.
