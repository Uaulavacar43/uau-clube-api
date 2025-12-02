// 1. Carrega variáveis de ambiente
import 'dotenv/config';

import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

// A função togglePlansStatus e sua chamada foram removidas
// para resolver o erro 'Unknown argument isActive' sem alterar o schema.

async function main() {
    // PARTE 1: CRIAÇÃO/ATUALIZAÇÃO DO USUÁRIO DE TESTE
    const targetEmail = 'testeapp@teste.com';
    const targetPassword = 'teste123456';
    const targetCpf = '00000000002'; // CPF de teste (pode ser ajustado se necessário)
    const targetName = "Usuário Teste App";

    console.log(`\n🔌 Conectando para lidar com o usuário Admin...`);

    const passwordHash = await hash(targetPassword, 8);

    // 1. Verifica se já existe ALGUÉM com esse CPF
    const userComCpf = await prisma.user.findUnique({
        where: { cpf: targetCpf }
    });

    // 2. Verifica se já existe ALGUÉM com esse Email
    const userComEmail = await prisma.user.findUnique({
        where: { email: targetEmail }
    });

    // LOGICA DE RESOLUÇÃO DE CONFLITO
    if (userComCpf) {
        console.log(`⚠️ Encontrado usuário existente com CPF ${targetCpf} (ID: ${userComCpf.id}).`);
        console.log(`🔄 Transformando este usuário no Admin de Teste...`);

        // Se existe um usuário com o email alvo mas NÃO é o mesmo do CPF, deleta o do email
        if (userComEmail && userComEmail.id !== userComCpf.id) {
            console.log(`🗑️ Removendo usuário antigo que usava o email ${targetEmail} para evitar duplicidade...`);
            await prisma.user.delete({ where: { id: userComEmail.id } });
        }

        // Atualiza o usuário dono do CPF para ser o Admin de Teste
        const user = await prisma.user.update({
            where: { id: userComCpf.id },
            data: {
                email: targetEmail,
                password: passwordHash,
                role: Role.ADMIN,
                status: UserStatus.ACTIVE,
                name: targetName
            }
        });
        logSucesso(user, targetPassword, "ATUALIZADO (Pelo CPF)");

    } else if (userComEmail) {
        console.log(`⚠️ Email ${targetEmail} já existe, mas está sem o CPF alvo.`);
        console.log(`🔄 Atualizando usuário...`);

        const user = await prisma.user.update({
            where: { id: userComEmail.id },
            data: {
                password: passwordHash,
                role: Role.ADMIN,
                status: UserStatus.ACTIVE,
                cpf: targetCpf,
                name: targetName
            }
        });
        logSucesso(user, targetPassword, "ATUALIZADO (Pelo Email)");

    } else {
        console.log(`🆕 Nenhum conflito encontrado. Criando novo Admin de Teste...`);

        const user = await prisma.user.create({
            data: {
                name: targetName,
                email: targetEmail,
                password: passwordHash,
                phone: "85999999999",
                cpf: targetCpf,
                role: Role.ADMIN,
                status: UserStatus.ACTIVE,
                firebaseTokens: [],
            },
        });
        logSucesso(user, targetPassword, "CRIADO DO ZERO");
    }
}

function logSucesso(user: any, pass: string, metodo: string) {
    console.log(`\n✅ SUCESSO! [Método: ${metodo}]`);
    console.log('------------------------------------------------');
    console.log(`👤 Nome:    ${user.name}`);
    console.log(`📧 Email:   ${user.email}`);
    console.log(`🆔 CPF:     ${user.cpf}`);
    console.log(`🔑 Senha:   ${pass}`);
    console.log(`👑 Cargo:   ${user.role}`);
    console.log('------------------------------------------------');
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error('\n❌ Erro ao executar script:', e);
        await prisma.$disconnect();
        process.exit(1);
    });