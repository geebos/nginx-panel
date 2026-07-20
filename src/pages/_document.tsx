import Document, {
  Html,
  Head,
  Main,
  NextScript,
  type DocumentContext,
  type DocumentInitialProps,
} from "next/document";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type AppLocale,
} from "@/i18n/settings";

type AppDocumentProps = DocumentInitialProps & { locale: AppLocale };

export default class AppDocument extends Document<AppDocumentProps> {
  static async getInitialProps(ctx: DocumentContext): Promise<AppDocumentProps> {
    const initialProps = await Document.getInitialProps(ctx);
    const queryLocale = ctx.query.locale;
    const locale =
      typeof queryLocale === "string" && isSupportedLocale(queryLocale)
        ? queryLocale
        : DEFAULT_LOCALE;
    return { ...initialProps, locale };
  }

  render() {
    return (
      <Html lang={this.props.locale}>
        <Head />
        <body className="antialiased">
          <Main />
          <NextScript />
        </body>
      </Html>
    );
  }
}
