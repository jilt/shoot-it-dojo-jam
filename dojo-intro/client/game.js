/**
 * Game logic.
 *
 * Updates the UI by parsing Torii responses.
 * Sends transactions to the chain using controller account.
 */

const NAMESPACE = 'di';
const REDEEM_MODEL = 'Redeem';

const ACTIONS_CONTRACT = 'di-actions';

function updateFromEntitiesData(entities) {
  entities.forEach((entity) => {
    // This function can be expanded to update the UI based on new models
    // like `Player` or `Redeem` if you add corresponding display elements.
    console.log('Received entity update:', entity);
  });
}

function initGame(account, manifest) {
  // Expose dojo variables to the window for access from GameScene
  window.dojo = {
    account,
    manifest,
    redeem,
  };
}

async function redeem(account, manifest, score) {
  // A u256 is represented as two u128 values (low, high).
  const scoreAsBigInt = BigInt(score);
  const low = scoreAsBigInt & ((1n << 128n) - 1n);
  const high = scoreAsBigInt >> 128n;

  const tx = await account.execute({
    contractAddress: manifest.contracts.find((contract) => contract.tag === ACTIONS_CONTRACT)
      .address,
    entrypoint: 'redeem',
    calldata: [low.toString(), high.toString()],
  });

  console.log('Transaction sent:', tx);
}
export { initGame, updateFromEntitiesData };
