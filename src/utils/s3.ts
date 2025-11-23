// src/utils/awsS3.ts
// Implementação usando Google Cloud Storage, mantendo a mesma API pública
// (createPresignedUrl, uploadObjectToAws, etc).

import path from "path";
import { Storage, GetSignedUrlConfig, DeleteFilesOptions } from "@google-cloud/storage";
import { envConfig } from "../config/envConfig";

const storage: Storage = new Storage({
    projectId: envConfig.GOOGLE_CLOUD_PROJECT,
    // Se GOOGLE_APPLICATION_CREDENTIALS estiver setado no .env,
    // o SDK já usa automaticamente. Não precisamos passar aqui.
});

const bucket = storage.bucket(envConfig.GCS_BUCKET_NAME);

/**
 * Mantém a mesma lógica de ambiente usada antes.
 */
export function getS3AmbientFolder(): string {
    const nodeEnv: string = envConfig.NODE_ENV.toLowerCase();

    if (nodeEnv.includes("prod")) {
        return "prod";
    }

    if (nodeEnv.includes("dev")) {
        return "dev";
    }

    if (nodeEnv.startsWith("h")) {
        return "homol";
    }

    return "dev";
}

function buildObjectPath(folder: string, fileName?: string): string {
    const ambient: string = getS3AmbientFolder();

    if (fileName !== undefined && fileName.trim() !== "") {
        return path.posix.join(ambient, folder, fileName);
    }

    return path.posix.join(ambient, folder);
}

function publicUrlFor(objectPath: string): string {
    // URL pública padrão do GCS (bucket público ou via regras)
    // Ex: https://storage.googleapis.com/<bucket>/<path>
    const normalized: string = objectPath.replace(/\\/g, "/");
    return `https://storage.googleapis.com/${envConfig.GCS_BUCKET_NAME}/${normalized}`;
}

interface CreatePresignedUrlParams {
    folder: string;
    fileName: string;
    contentType: string;
}

/**
 * Cria URL assinada de upload (PUT) + URL pública de leitura.
 * - url: URL assinada para upload direto (frontend → GCS)
 * - urlView: URL pública de leitura do arquivo após upload
 */
export const createPresignedUrl = async ({
                                             folder,
                                             fileName,
                                             contentType,
                                         }: CreatePresignedUrlParams): Promise<{
    url: string;
    urlView: string;
}> => {
    const objectPath: string = buildObjectPath(folder, fileName);
    const file = bucket.file(objectPath);

    const config: GetSignedUrlConfig = {
        action: "write",
        expires: Date.now() + 24 * 60 * 60 * 1000, // 24h
        contentType,
    };

    const [signedUrl] = await file.getSignedUrl(config);
    const urlView: string = publicUrlFor(objectPath);

    return {
        url: signedUrl,
        urlView,
    };
};

interface UploadFileToAwsParams {
    folder: string;
    fileName: string;
    file: Buffer | string;
    contentType: string;
}

/**
 * Upload feito pelo backend diretamente para o GCS.
 * Retorna a URL pública.
 */
export const uploadObjectToAws = async ({
                                            folder,
                                            fileName,
                                            file,
                                            contentType,
                                        }: UploadFileToAwsParams): Promise<string> => {
    const objectPath: string = buildObjectPath(folder, fileName);
    const fileRef = bucket.file(objectPath);

    await fileRef.save(file, {
        contentType,
        resumable: false,
    });

    const url: string = publicUrlFor(objectPath);

    return url;
};

/**
 * Remove um único arquivo OU tenta remover um "pseudo-arquivo" de pasta.
 */
export const removeObjectFromAws = async ({
                                              folder,
                                              fileName,
                                          }: {
    folder: string;
    fileName?: string;
}): Promise<void> => {
    const objectPath: string = buildObjectPath(folder, fileName);

    try {
        await bucket.file(objectPath).delete({ ignoreNotFound: true });
    } catch (error) {
        // Se der erro por não encontrado, ignoramos; outros erros devem subir.
        // eslint-disable-next-line no-console
        console.error("Erro ao remover objeto do GCS:", error);
    }
};

/**
 * Remove todos os arquivos que tenham prefixo da pasta.
 */
export const removeDirectoryFromAws = async (folder: string): Promise<void> => {
    const prefix: string = `${buildObjectPath(folder).replace(/\\/g, "/")}/`;

    const options: DeleteFilesOptions = {
        prefix,
    };

    try {
        // deleteFiles remove todos os objetos com o prefixo fornecido
        await bucket.deleteFiles(options);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Erro ao remover diretório no GCS:", error);
    }
};

/**
 * Verifica se existe ao menos um objeto com aquele prefixo (pasta lógica).
 */
export const checkIfFolderExistsInAws = async (
    folder: string,
): Promise<boolean> => {
    const prefix: string = `${buildObjectPath(folder).replace(/\\/g, "/")}/`;

    try {
        const [files] = await bucket.getFiles({
            prefix,
            maxResults: 1,
        });

        return files.length > 0;
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Erro ao verificar pasta no GCS:", error);
        return false;
    }
};
