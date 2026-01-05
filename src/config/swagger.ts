// src/config/swagger.ts
import path from "path";

type SwaggerJSDocBuildOptions = {
    definition: Record<string, unknown>;
    apis: string[];
    failOnErrors?: boolean;
    explorer?: boolean;
    swaggerDefinition?: Record<string, unknown>;
};

type SwaggerJSDocFn = (options: SwaggerJSDocBuildOptions) => any;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const swaggerJSDoc = require("swagger-jsdoc") as SwaggerJSDocFn;

const DEFAULT_TITLE = "UAU Clube API";
const DEFAULT_DESCRIPTION = "Documentação da API";
const DEFAULT_VERSION = "1.0.0";
const DEFAULT_SERVER_URL = "http://localhost:3002";
const DEFAULT_SERVER_DESCRIPTION = "Servidor local";

const SWAGGER_TITLE = process.env.SWAGGER_TITLE ?? DEFAULT_TITLE;
const SWAGGER_DESCRIPTION = process.env.SWAGGER_DESCRIPTION ?? DEFAULT_DESCRIPTION;
const SWAGGER_VERSION = process.env.SWAGGER_VERSION ?? DEFAULT_VERSION;

const SWAGGER_SERVER_URL = process.env.SWAGGER_SERVER_URL ?? DEFAULT_SERVER_URL;
const SWAGGER_SERVER_DESCRIPTION =
    process.env.SWAGGER_SERVER_DESCRIPTION ?? DEFAULT_SERVER_DESCRIPTION;

function buildApisGlobs(): string[] {
    const projectRoot = process.cwd();

    const srcGlobTs = path.join(projectRoot, "src", "**", "*.ts");
    const srcGlobTsx = path.join(projectRoot, "src", "**", "*.tsx");

    const distGlobJs = path.join(projectRoot, "dist", "**", "*.js");
    const distGlobCjs = path.join(projectRoot, "dist", "**", "*.cjs");
    const distGlobMjs = path.join(projectRoot, "dist", "**", "*.mjs");

    return [srcGlobTs, srcGlobTsx, distGlobJs, distGlobCjs, distGlobMjs];
}

const swaggerOptions: SwaggerJSDocBuildOptions = {
    definition: {
        openapi: "3.0.3",
        info: {
            title: SWAGGER_TITLE,
            description: SWAGGER_DESCRIPTION,
            version: SWAGGER_VERSION,
        },
        servers: [
            {
                url: SWAGGER_SERVER_URL,
                description: SWAGGER_SERVER_DESCRIPTION,
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                },
            },
        },
        security: [{ bearerAuth: [] }],
    },
    apis: buildApisGlobs(),
    failOnErrors: false,
};

export const swaggerSpec = swaggerJSDoc(swaggerOptions);
export default swaggerSpec;
