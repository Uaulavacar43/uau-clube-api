import {
	DeleteObjectCommand,
	DeleteObjectsCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	paginateListObjectsV2,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import { envConfig } from "../config/envConfig";

const client = new S3Client({
	region: envConfig.AWS_S3_BUCKET_REGION,
	credentials: {
		accessKeyId: envConfig.AWS_ACCESS_KEY,
		secretAccessKey: envConfig.AWS_SECRET_KEY,
	},
});

export function getS3AmbientFolder() {
	if (envConfig.NODE_ENV.includes("prod")) return "prod";
	if (envConfig.NODE_ENV.includes("dev")) return "dev";
	if (envConfig.NODE_ENV.startsWith("h")) return "homol";

	return "dev";
}

interface CreatePresignedUrlParams {
	folder: string;
	fileName: string;
	contentType: string;
}

export const createPresignedUrl = async ({
	folder,
	fileName,
	contentType,
}: CreatePresignedUrlParams) => {
	const fileKeyPath = path.posix.join(getS3AmbientFolder(), folder, fileName);
	const command = new PutObjectCommand({
		Bucket: envConfig.AWS_S3_BUCKET_NAME,
		Key: fileKeyPath,
		ContentType: contentType,
		// Body: JSON.stringify({ hello: 'S3' }),
	});
	const url = await getSignedUrl(client, command, { expiresIn: 3600 * 24 }); // 1 day

	const urlView = `https://s3.${envConfig.AWS_S3_BUCKET_REGION}.amazonaws.com/${envConfig.AWS_S3_BUCKET_NAME}/${fileKeyPath}`;

	return {
		url,
		urlView,
	};
};

interface UploadFileToAwsParams {
	folder: string;
	fileName: string;
	file: Buffer | string;
	contentType: string;
}

export const uploadObjectToAws = async ({
	folder,
	fileName,
	file,
	contentType,
}: UploadFileToAwsParams) => {
	const fileKeyPath = path.posix.join(getS3AmbientFolder(), folder, fileName);
	const command = new PutObjectCommand({
		Bucket: envConfig.AWS_S3_BUCKET_NAME,
		Key: fileKeyPath,
		ContentType: contentType,
		Body: file,
	});

	await client.send(command);
	const url = `https://s3.${envConfig.AWS_S3_BUCKET_REGION}.amazonaws.com/${envConfig.AWS_S3_BUCKET_NAME}/${fileKeyPath}`;

	return url;
};

export const removeObjectFromAws = async ({
	folder,
	fileName,
}: {
	folder: string;
	fileName?: string;
}) => {
	const keyPath = path.posix.join(getS3AmbientFolder(), folder);
	const command = new DeleteObjectCommand({
		Bucket: envConfig.AWS_S3_BUCKET_NAME,
		Key: fileName ? path.posix.join(keyPath, fileName) : keyPath,
	});

	return client.send(command);
};

export const removeDirectoryFromAws = async (folder: string) => {
	const keyPath = path.posix.join(getS3AmbientFolder(), folder, "/");

	const existFolder = await checkIfFolderExistsInAws(folder);
	if (!existFolder) return;

	async function getAndDelete(currentContinuationToken?: string) {
		const page = await paginateListObjectsV2(
			{ client, pageSize: 1000, startingToken: currentContinuationToken },
			{ Bucket: envConfig.AWS_S3_BUCKET_NAME, Prefix: keyPath },
		).next();

		const command = new DeleteObjectsCommand({
			Bucket: envConfig.AWS_S3_BUCKET_NAME,
			Delete: {
				Objects: page.value?.Contents?.map(({ Key }) => ({ Key })) ?? [],
			},
		});

		await client.send(command);

		if (page.value?.NextContinuationToken) {
			await getAndDelete(page.value.NextContinuationToken);
		} else {
			if (!page.value?.Prefix) return;
			await removeObjectFromAws({ folder: page.value.Prefix });
		}
	}

	await getAndDelete();
};

export const checkIfFolderExistsInAws = async (
	folder: string,
): Promise<boolean> => {
	const keyPath = path.posix.join(getS3AmbientFolder(), folder, "/");

	const command = new ListObjectsV2Command({
		Bucket: envConfig.AWS_S3_BUCKET_NAME,
		Prefix: keyPath,
		MaxKeys: 1, // Limita a busca a apenas um objeto
	});

	const response = await client.send(command);

	// Verifica se hÃ¡ algum objeto com o prefixo fornecido
	return !!response.Contents && response.Contents.length > 0;
};
