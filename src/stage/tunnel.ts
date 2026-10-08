import tunnel from 'tunnel-rat';

/** Game scenes render into the one persistent <Canvas> through this tunnel. */
export const sceneTunnel = tunnel();
