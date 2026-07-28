import '@tanstack/react-query';

declare module '@tanstack/react-query' {
  interface Register {
    /**
     * `meta.silent` opts a mutation out of the global error toast, for the cases where a
     * component renders the failure inline instead — e.g. a login form showing the error
     * under the password field rather than as a floating message.
     */
    mutationMeta: { silent?: boolean };
  }
}
