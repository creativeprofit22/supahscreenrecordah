export const VOICE_ENHANCE_FILTER_BASE = [
  'agate=threshold=0.015:attack=20:release=250',
  'highpass=f=80',
  'afftdn=nf=-35',
  'equalizer=f=200:width_type=h:width=150:g=-3',
  'equalizer=f=2500:width_type=h:width=1000:g=4',
  'equalizer=f=8000:width_type=h:width=2000:g=2',
  'aexciter=level_in=1:level_out=1:amount=2:drive=8.5',
  'acompressor=threshold=0.089:ratio=4:attack=10:release=250:makeup=4',
].join(',');

/** Loudnorm target values — -14 LUFS matches YouTube's normalization target. */
export const LOUDNORM_I = -14;
export const LOUDNORM_TP = -1.5;
export const LOUDNORM_LRA = 11;

/**
 * No post-loudnorm boost — loudnorm at -14 LUFS is YouTube's exact target.
 * The limiter at -1 dBFS is a safety net for intersample peak overshoot
 * that can occur after AAC encoding.
 */
export const POST_BOOST_FILTERS = 'alimiter=limit=0.89:level=false';
