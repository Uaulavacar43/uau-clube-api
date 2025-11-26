// 1. Carrega variáveis de ambiente
import 'dotenv/config';

import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    const targetEmail = 'admin@uauclube.com.br';
    const targetPassword = '123123';

    // Este é o CPF que deu conflito (o placeholder que já existe no banco)
    const targetCpf = '00000000001';

    console.log(`🔌 Conectando...`);

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
        console.log(`🔄 Transformando este usuário no Admin...`);

        // Se existe um usuário com o email 'admin@...' mas NÃO é o mesmo do CPF,
        // precisamos deletar o do email para não dar erro de email duplicado ao atualizar o do CPF.
        if (userComEmail && userComEmail.id !== userComCpf.id) {
            console.log(`🗑️ Removendo usuário antigo que usava o email ${targetEmail} para evitar duplicidade...`);
            await prisma.user.delete({ where: { id: userComEmail.id } });
        }

        // Atualiza o usuário dono do CPF para ser o Admin
        const user = await prisma.user.update({
            where: { id: userComCpf.id },
            data: {
                email: targetEmail, // Define o email do admin
                password: passwordHash,
                role: Role.ADMIN,
                status: UserStatus.ACTIVE,
                name: "Super Admin Uau"
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
                cpf: targetCpf, // Tenta atribuir o CPF (já sabemos que está livre pois caiu no else do userComCpf)
            }
        });
        logSucesso(user, targetPassword, "ATUALIZADO (Pelo Email)");

    } else {
        console.log(`🆕 Nenhum conflito encontrado. Criando novo Admin...`);

        const user = await prisma.user.create({
            data: {
                name: "Super Admin Uau",
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