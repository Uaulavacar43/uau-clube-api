export function registrationEmail(userName: string, role: "USER" | "MANAGER") {
	const subject =
		role === "USER"
			? "Bem-vindo ao UAU Clube!"
			: "Bem-vindo, Gerente - UAU Clube";

	const text =
		role === "USER"
			? `Olá ${userName},\n\nBem-vindo ao UAU Clube! Estamos muito felizes em tê-lo conosco.`
			: `Olá ${userName},\n\nObrigado por se registrar como Gerente no UAU Clube!`;

	const html =
		role === "USER"
			? `<h1>Bem-vindo, ${userName}!</h1><p>Bem-vindo ao UAU Clube! Estamos muito felizes em tê-lo conosco.</p>`
			: `<h1>Bem-vindo, Gerente!</h1><p>Olá ${userName}, obrigado por se juntar ao UAU Clube como Gerente!</p>`;

	return { subject, text, html };
}
