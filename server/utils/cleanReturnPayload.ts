// SDK objects carry topia.interactiveSecret, requestOptions.headers.InteractiveJWT and credentials;
// SDK errors carry params.interactiveSecret.
const keys = ["topia", "credentials", "jwt", "requestOptions", "interactiveSecret"];

export const cleanReturnPayload = (payload: any) => {
  const keyExists = (payload: any) => {
    if (!payload || (typeof payload !== "object" && !Array.isArray(payload))) return payload;

    for (const i in keys) {
      const key = keys[i];
      if (payload.hasOwnProperty(key)) {
        delete payload[key];
      } else if (Array.isArray(payload)) {
        for (let i = 0; i < payload.length; i++) {
          const result = keyExists(payload[i]);
          if (result) delete payload[i][key];
        }
      } else {
        for (const k in payload) {
          const result = keyExists(payload[k]);
          if (result) delete payload[k][key];
        }
      }
    }

    return payload;
  };
  keyExists(payload);
  return payload;
};
