// scripts/seed-test-users.js
require("dotenv").config();

const { PrismaClient, Prisma } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@local.test";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

const USER_EMAIL = process.env.USER_EMAIL || "user@local.test";
const USER_PASSWORD = process.env.USER_PASSWORD || "user123";

function getUserModel() {
    const model = Prisma?.dmmf?.datamodel?.models?.find((m) => m.name === "User");
    if (!model) throw new Error("Model User não encontrado no Prisma DMMF.");
    return model;
}

function hasField(userModel, fieldName) {
    return userModel.fields.some((f) => f.name === fieldName);
}

function getField(userModel, fieldName) {
    return userModel.fields.find((f) => f.name === fieldName);
}

function setIfExists(obj, userModel, fieldName, value) {
    if (hasField(userModel, fieldName)) obj[fieldName] = value;
}

function enumFirstValue(enumName) {
    const enumDef = Prisma?.dmmf?.datamodel?.enums?.find((e) => e.name === enumName);
    return enumDef?.values?.[0]?.name ?? null;
}

// -----------------------------
// CPF válido (com dígitos)
// -----------------------------
function calcCpfDigit(nums) {
    let sum = 0;
    for (let i = 0; i < nums.length; i++) {
        sum += nums[i] * (nums.length + 1 - i);
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
}

function generateValidCpf() {
    // 9 dígitos base
    const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    const d1 = calcCpfDigit(base);
    const d2 = calcCpfDigit([...base, d1]);
    return [...base, d1, d2].join("");
}

async function resolveUniqueCpfForEmail(desiredCpf, email) {
    const userModel = getUserModel();

    // Seu schema acusa unique em `cpf`, então priorizamos esse
    const cpfFieldName = hasField(userModel, "cpf")
        ? "cpf"
        : hasField(userModel, "cpfCnpj")
            ? "cpfCnpj"
            : null;

    if (!cpfFieldName) return null;

    const cpfField = getField(userModel, cpfFieldName);
    const isUnique = cpfField?.isUnique === true;

    // 1) Se o usuário por email já existe, reaproveita o CPF dele (evita churn e colisões)
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail && existingByEmail[cpfFieldName]) {
        return existingByEmail[cpfFieldName];
    }

    // 2) Se não for unique, só usa o desejado ou gera um válido
    if (!isUnique) {
        return desiredCpf || generateValidCpf();
    }

    // 3) Se for unique: tenta desiredCpf primeiro, mas checa colisão
    let candidate = desiredCpf && String(desiredCpf).trim().length > 0 ? String(desiredCpf) : null;

    // Se desiredCpf for ruim/curto, gera
    if (!candidate || candidate.length < 11) {
        candidate = generateValidCpf();
    }

    // Loop de unicidade (findUnique só funciona se o campo for unique, e aqui ele é)
    while (true) {
        const hit = await prisma.user.findUnique({ where: { [cpfFieldName]: candidate } });
        if (!hit) return candidate;

        // se já existe com outro user, gera outro CPF válido
        candidate = generateValidCpf();
    }
}

/**
 * Retorna { createData, updateData } para usar em upsert.
 * - List fields no update: { set: [] }
 * - List fields no create: []
 */
async function buildUserDataPair({ email, name, role, passwordPlain, cpfDesired }) {
    const userModel = getUserModel();
    const passwordHash = bcrypt.hashSync(passwordPlain, 10);

    // resolve CPF de forma segura (evita P2002)
    const cpfResolved = await resolveUniqueCpfForEmail(cpfDesired, email);

    const createData = { email, name };
    const updateData = { email, name };

    // role (se existir)
    setIfExists(createData, userModel, "role", role);
    setIfExists(updateData, userModel, "role", role);

    // senha: seu schema exige `password` (hash). Mantém compatibilidade se existir passwordHash/hashedPassword.
    setIfExists(createData, userModel, "password", passwordHash);
    setIfExists(updateData, userModel, "password", passwordHash);

    setIfExists(createData, userModel, "passwordHash", passwordHash);
    setIfExists(updateData, userModel, "passwordHash", passwordHash);

    setIfExists(createData, userModel, "hashedPassword", passwordHash);
    setIfExists(updateData, userModel, "hashedPassword", passwordHash);

    // cpf/cpfCnpj (depende do schema)
    if (cpfResolved) {
        setIfExists(createData, userModel, "cpf", cpfResolved);
        setIfExists(updateData, userModel, "cpf", cpfResolved);

        setIfExists(createData, userModel, "cpfCnpj", cpfResolved);
        setIfExists(updateData, userModel, "cpfCnpj", cpfResolved);
    }

    // Preenche campos scalar/enum REQUIRED (sem default) para não quebrar seed,
    // respeitando listas (String[] como firebaseTokens).
    for (const field of userModel.fields) {
        const isScalarOrEnum = field.kind === "scalar" || field.kind === "enum";

        const needsValue =
            isScalarOrEnum &&
            field.isRequired === true &&
            field.hasDefaultValue !== true &&
            field.isId !== true &&
            field.isUpdatedAt !== true;

        if (!needsValue) continue;

        // não sobrescreve se já setado
        const alreadySetCreate = createData[field.name] !== undefined;
        const alreadySetUpdate = updateData[field.name] !== undefined;

        if (field.isList) {
            if (!alreadySetCreate) createData[field.name] = [];
            if (!alreadySetUpdate) updateData[field.name] = { set: [] };
            continue;
        }

        // enums
        if (field.kind === "enum") {
            if (!alreadySetCreate) createData[field.name] = enumFirstValue(field.type);
            if (!alreadySetUpdate) updateData[field.name] = enumFirstValue(field.type);
            continue;
        }

        // scalars
        if (!alreadySetCreate) {
            switch (field.type) {
                case "String":
                    if (field.name.toLowerCase().includes("email")) createData[field.name] = email;
                    else if (field.name.toLowerCase().includes("name")) createData[field.name] = name;
                    else if (field.name.toLowerCase().includes("phone")) createData[field.name] = "999999999";
                    else if (field.name.toLowerCase().includes("token")) createData[field.name] = "";
                    else createData[field.name] = "seed";
                    break;

                case "Boolean":
                    createData[field.name] = true;
                    break;

                case "Int":
                case "Float":
                case "Decimal":
                    createData[field.name] = 0;
                    break;

                case "DateTime":
                    createData[field.name] = new Date();
                    break;

                case "Json":
                    createData[field.name] = {};
                    break;

                default:
                    break;
            }
        }

        if (!alreadySetUpdate) {
            switch (field.type) {
                case "String":
                    if (field.name.toLowerCase().includes("email")) updateData[field.name] = email;
                    else if (field.name.toLowerCase().includes("name")) updateData[field.name] = name;
                    else if (field.name.toLowerCase().includes("phone")) updateData[field.name] = "999999999";
                    else if (field.name.toLowerCase().includes("token")) updateData[field.name] = "";
                    else updateData[field.name] = "seed";
                    break;

                case "Boolean":
                    updateData[field.name] = true;
                    break;

                case "Int":
                case "Float":
                case "Decimal":
                    updateData[field.name] = 0;
                    break;

                case "DateTime":
                    updateData[field.name] = new Date();
                    break;

                case "Json":
                    updateData[field.name] = {};
                    break;

                default:
                    break;
            }
        }
    }

    return { createData, updateData };
}

async function upsertUser({ email, name, role, passwordPlain, cpfDesired }) {
    const { createData, updateData } = await buildUserDataPair({
        email,
        name,
        role,
        passwordPlain,
        cpfDesired,
    });

    return prisma.user.upsert({
        where: { email },
        create: createData,
        update: updateData,
    });
}

async function main() {
    console.log("Seeding test users...");

    const admin = await upsertUser({
        email: ADMIN_EMAIL,
        name: "Admin Local",
        role: "ADMIN",
        passwordPlain: ADMIN_PASSWORD,
        // opcional: se você quiser sugerir um CPF fixo; se colidir, o script gera outro
        cpfDesired: "00000000000",
    });

    const user = await upsertUser({
        email: USER_EMAIL,
        name: "User Local",
        role: "USER",
        passwordPlain: USER_PASSWORD,
        cpfDesired: null, // deixa gerar um CPF válido e livre automaticamente
    });

    console.log("OK:", {
        admin: { id: admin.id, email: admin.email, role: admin.role, cpf: admin.cpf ?? admin.cpfCnpj },
        user: { id: user.id, email: user.email, role: user.role, cpf: user.cpf ?? user.cpfCnpj },
    });
}

main()
    .catch((e) => {
        console.error("Seed failed:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
