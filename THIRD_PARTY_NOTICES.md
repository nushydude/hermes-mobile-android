# Third-party notices

Hermes Mobile is an independent client for [Hermes Agent](https://github.com/NousResearch/hermes-agent).
It is not an official Nous Research product.

- The shared gateway protocol files under `packages/hermes-protocol/src/vendor/` are
  copied from Hermes Agent and retain the Nous Research MIT license in
  [LICENSE.hermes](packages/hermes-protocol/LICENSE.hermes). Their source hashes are
  recorded in [provenance.json](packages/hermes-protocol/src/vendor/provenance.json).
- The Expo project retains its template license in [app/LICENSE](app/LICENSE),
  copyright 650 Industries, Inc. (Expo).
- Expo, React Native, React, Notifee, Ionicons and other dependencies retain their
  respective licenses. Dependency versions are recorded in `package-lock.json`;
  their license texts are distributed in the installed packages. The root MIT
  license does not replace those notices.

When distributing a build, include the applicable notices for its dependencies.
This source repository does not bundle an Android APK or a speech/model service.
