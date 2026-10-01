# Leo — vidéo marketing

Projet annexe (indépendant de la homepage) : vidéo promotionnelle de Leo,
l'agent IA de Legaleo, réalisée avec [Remotion](https://www.remotion.dev).

- 33 s, 1920 × 1080, 30 i/s, sans son.
- Polices et couleurs de la homepage (Fraunces, Manrope, teal / cyan / lime).
- Animations Lottie du vrai badge Leo (`public/lottie/`, copiées depuis
  `legaleo-ai/components/design-system/LeoBadge/lottie`), et ses vrais états
  (« Réfléchit… », « Recherche sur Légifrance… », « Rédige la réponse… »,
  « Réponse prête »).

## Scènes (`src/LeoPromo.tsx`)

1. Accroche : « Il est 22 h 47. » puis « Une question juridique sur votre réseau ? »
2. Leo apparaît : le premier agent IA dédié à la franchise (Bêta)
3. Démo : question sur le DIP, recherche Légifrance, réponse sourcée,
   garde-fou « à valider avec votre avocat dédié »
4. Trois bénéfices : rapidité, sources, accompagnement
5. « Leo propose. Vous décidez. Votre avocat valide. »
6. Logo Legaleo + « Découvrir Leo »

## Commandes

```sh
npm install
npm run studio   # aperçu interactif
npm run render   # → out/leo-promo.mp4
npm run still    # → out/leo-poster.png
```
