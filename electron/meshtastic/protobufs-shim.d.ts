// The npm package @meshtastic/protobufs@2.7.18 publishes a broken `types`
// field (points to dist/mod.d.ts which isn't shipped). Treat it as `any`
// so we can use the schemas at runtime via dynamic import.
declare module '@meshtastic/protobufs';
