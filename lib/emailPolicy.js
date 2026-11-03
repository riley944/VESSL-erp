// A separate Vercel project sets APP_ENV for all of its deployments. The
// branch check also protects develop previews in the production project.
export function emailDisabled() {
  return process.env.APP_ENV === 'development' || process.env.VERCEL_GIT_COMMIT_REF === 'develop';
}
