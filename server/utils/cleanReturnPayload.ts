// SDK objects carry topia.interactiveSecret, requestOptions.headers.InteractiveJWT and credentials;
// SDK errors carry params.interactiveSecret.
const keys = ["topia", "credentials", "jwt", "requestOptions", "interactiveSecret"];

// Deletes those keys at any depth, in place. One pass over the payload: the previous version re-walked
// every child once per key, which took seconds on a few levels of nesting.
export const cleanReturnPayload = (payload: any) => {
  const seen = new WeakSet();
  const clean = (value: any) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const key of keys) delete value[key];
    for (const k in value) clean(value[k]);
  };
  clean(payload);
  return payload;
};
