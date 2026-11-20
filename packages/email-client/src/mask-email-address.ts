/**
 * The mailbox's first character and the whole domain, such as `a•••@example.com`, so a notice says where an address
 * is going without spelling it out. An address with no `@`, or one that starts with it, becomes `•••`.
 */
export const maskEmailAddress = (email: string): string => {
  const at = email.lastIndexOf("@");
  return at <= 0 ? "•••" : `${email.slice(0, 1)}•••${email.slice(at)}`;
};
