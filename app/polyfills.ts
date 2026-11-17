// Must execute before importing any Hermes protocol source: upstream constructs
// TextDecoder at module evaluation time. No credentials are bundled in the app.
import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import 'fast-text-encoding';
