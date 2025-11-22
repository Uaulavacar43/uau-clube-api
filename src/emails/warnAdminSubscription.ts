export function warnAdminSubscription(userName: string) {
	const html = `
    <h1>Houve um problema com a assinatura do cliente</h1>
		<p>Cliente: <strong>${userName}</strong></p>
    <p>Ao cancelar a assinatura, foi verificar que não havia id da assinatura salva no ASAAS</p>
		<p>Por favor, verifique o id da assinatura no ASAAS e contate o suporte da plataforma</p>
  `.replace(/(\r\n|\n|\r|\t)/gm, "");

	const text = `Houve um problema com a assinatura do cliente: ${userName}\n\nAo cancelar a assinatura, foi verificar que não havia id da assinatura salva no ASAAS\n\nPor favor, verifique o id da assinatura no ASAAS e contate o suporte da plataforma`;
	const subject = "Problema com a assinatura do cliente";

	return { html, text, subject };
}
