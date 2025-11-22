export function forgotPasswordEmail(otp: string) {
	const html = `
    <h1>Esqueceu sua senha?</h1>
    <p>Copie o código abaixo e cole no aplicativo:</p>
    <strong>${otp}</strong>
    <br />
    <br />
    <p>Se você não solicitou esta alteração, por favor ignore este e-mail.</p>
  `.replace(/(\r\n|\n|\r|\t)/gm, "");

	const text = `Esqueceu sua senha?\nCopie o código abaixo e cole no aplicativo:\n${otp}`;
	const subject = "Redefinição de Senha";

	return { html, text, subject };
}
