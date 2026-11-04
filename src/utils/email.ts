import { Resend } from "resend";

let resend: Resend | null = null;

const sanitizeEmailSubject = (subject: string) => {
  return subject
    .replace(/[\x00-\x1f\x7f]/g, "") // Remove control characters
    .replace(/\s+/g, " ") // Replace whitespace with spaces
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .trim(); // Remove leading and trailing whitespace
};

const getResend = () => {
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY!);
  }
  return resend;
};

// At least one of html or text must be provided
// If html is provided, text can optionally be provided as well

interface SendTransactionalEmailBase {
  to: string;
  subject: string;
  replyTo?: string;
}

interface SendTransactionalEmailWithHtml extends SendTransactionalEmailBase {
  html: string;
  text?: string;
}

interface SendTransactionalEmailWithText extends SendTransactionalEmailBase {
  text: string;
}

export const sendTransactionalEmail = async (args: SendTransactionalEmailWithHtml | SendTransactionalEmailWithText) => {
  const noreply = process.env.EMAIL_NOREPLY!;
  const sanitizedSubject = sanitizeEmailSubject(args.subject);

  const { error } = await getResend().emails.send({
    from: `Hackdex <${noreply}>`,
    to: args.to,
    replyTo: args.replyTo,
    subject: sanitizedSubject,
    ...("html" in args ? { html: args.html, text: args.text } : { text: args.text }),
  });
  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
};
