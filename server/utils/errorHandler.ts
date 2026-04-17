export const errorHandler = ({
  error,
  functionName,
  message,
  req,
  res,
}: {
  error: any;
  functionName: string;
  message: string;
  req?: any;
  res?: any;
}) => {
  try {
    if (process.env.NODE_ENV === "development") {
      console.error("❌ Error:", error);
    } else {
      const reqQueryParams = req?.query;
      if (reqQueryParams?.interactiveNonce) delete reqQueryParams.interactiveNonce;

      console.error(
        JSON.stringify({
          errorContext: {
            message,
            functionName,
          },
          requestContext: {
            requestId: req?.id,
            reqQueryParams,
            reqBody: req?.body,
          },
          error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        }),
      );
    }

    if (res && !res.headersSent) return res.status(error.status || 500).send({ error, message, success: false });

    return { error };
  } catch (e) {
    console.error("❌ Error printing the logs", e);
    if (res && !res.headersSent) return res.status(500).send({ error: e, message, success: false });
    return { error: e };
  }
};
