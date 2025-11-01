import {
  Clock,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import GameEntity from "../entities/GameEntity";
import GameMap from "../map/GameMap";
import ResourceManager from "../utils/ResourceManager";
import PlayerTank from "../entities/PlayerTank";
import Wall from "../map/Wall";
import EnemyTank from "../entities/EnemyTank";

class GameScene {
  private static _instance = new GameScene();
  public static get instance() {
    return this._instance;
  }
  private _width: number;
  private _height: number;
  private _renderer: WebGLRenderer;
  private _camera: PerspectiveCamera;

  // three js scene
  private readonly _scene = new Scene();

  // game entities array
  private _gameEntities: GameEntity[] = [];

  // counter for defeated enemies
  private _enemiesDefeatedCount = 0;

  // score ui
  private _scoreElement: HTMLDivElement;
  private _scoreTimeoutId: number | undefined;

  // game state
  private _isGameOver = false;

  private _clock: Clock = new Clock();

  // map size
  private _mapSize = 15;

  // expose the camera
  public get camera() {
    return this._camera;
  }

  // expose current entities
  public get gameEntities() {
    return this._gameEntities;
  }

  // expose map size
  public get mapSize() {
    return this._mapSize;
  }

  private constructor() {
    this._width = window.innerWidth;
    this._height = window.innerHeight;

    this._renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(this._width, this._height);
    // find the target html element
    const targetElement = document.querySelector<HTMLDivElement>("#app");
    if (!targetElement) {
      throw "unable to find target element";
    }
    targetElement.appendChild(this._renderer.domElement);

    // Set a background gradient for the scene
    document.body.style.margin = "0";
    document.body.style.background = "linear-gradient(to bottom, #110101, #550000)";
    document.body.style.backgroundRepeat = "no-repeat";
    document.body.style.minHeight = "100vh"; // Ensure body is at least full viewport height

    // setup camera
    const aspectRatio = this._width / this._height;
    this._camera = new PerspectiveCamera(45, aspectRatio, 0.1, 1000);
    this._camera.position.set(7, 7, 15);
    this._camera.up.set(0, 0, 1); // Set the Z-axis as "up"

    // listen to size change
    window.addEventListener("resize", this.resize, false);

    // add the game map
    const gameMap = new GameMap(new Vector3(0, 0, 0), this._mapSize);
    this._gameEntities.push(gameMap);

    // add the player tank
    const playerTank = new PlayerTank(new Vector3(7, 7, 0));
    this._gameEntities.push(playerTank);

    const enemyTank = new EnemyTank(new Vector3(3, 3, 0));
    this._gameEntities.push(enemyTank);

    this.createWalls();
    this.createInnerWalls();

    // Expose the instance to the window for debugging purposes
    (window as any).gameScene = this;

    // Create the score UI element
    this._scoreElement = document.createElement("div");
    this._scoreElement.style.position = "absolute";
    this._scoreElement.style.bottom = "20px";
    this._scoreElement.style.left = "20px";
    this._scoreElement.style.color = "white";
    this._scoreElement.style.fontFamily = "sans-serif";
    this._scoreElement.style.fontSize = "2rem";
    this._scoreElement.style.textShadow = "2px 2px 4px #000000";
    this._scoreElement.style.opacity = "0"; // Initially transparent
    this._scoreElement.style.transition = "opacity 0.5s ease-in-out";

    document.body.appendChild(this._scoreElement);

    // Create the interactions UI element
    const interactionsBox = document.createElement("div");
    interactionsBox.style.position = "absolute";
    interactionsBox.style.top = "20px";
    interactionsBox.style.left = "20px";
    interactionsBox.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
    interactionsBox.style.color = "lightgrey";
    interactionsBox.style.padding = "15px";
    interactionsBox.style.borderRadius = "8px";
    interactionsBox.style.fontFamily = "sans-serif";
    interactionsBox.style.fontSize = "1rem";
    interactionsBox.style.lineHeight = "1.5";
    interactionsBox.style.textShadow = "1px 1px 2px #000000";

    const title = document.createElement("h3");
    title.innerText = "Controls";
    title.style.marginTop = "0";
    title.style.marginBottom = "10px";
    title.style.borderBottom = "1px solid rgba(255, 255, 255, 0.5)";
    title.style.paddingBottom = "5px";

    const controlsText = document.createElement("p");
    controlsText.style.margin = "0";
    controlsText.innerHTML = `<b>Arrow Keys:</b> Move & Rotate<br/><b>Spacebar:</b> Shoot`;

    interactionsBox.appendChild(title);
    interactionsBox.appendChild(controlsText);
    document.body.appendChild(interactionsBox);
  }

  private createWalls = () => {
    // helper variable for wall placement
    const edge = this._mapSize - 1;

    // add 4 edge walls
    this._gameEntities.push(new Wall(new Vector3(0, 0, 0)));
    this._gameEntities.push(new Wall(new Vector3(edge, 0, 0)));
    this._gameEntities.push(new Wall(new Vector3(edge, edge, 0)));
    this._gameEntities.push(new Wall(new Vector3(0, edge, 0)));

    // fill in the gaps between the edge walls
    for (let i = 1; i < edge; i++) {
      this._gameEntities.push(new Wall(new Vector3(i, 0, 0)));
      this._gameEntities.push(new Wall(new Vector3(0, i, 0)));
      this._gameEntities.push(new Wall(new Vector3(edge, i, 0)));
      this._gameEntities.push(new Wall(new Vector3(i, edge, 0)));
    }
  };

  private createInnerWalls = () => {
    const numberOfWalls = 15;
    const innerMapSize = this._mapSize - 2; // Walls can be from 1 to 13
    const occupiedPositions = new Set<string>();

    // Add player and enemy start positions to the set of occupied/forbidden spots.
    occupiedPositions.add("7,7");
    occupiedPositions.add("3,3");

    // Create a 3x3 safe zone around the player's starting position (7,7)
    const playerStart = { x: 7, y: 7 };
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        occupiedPositions.add(`${playerStart.x + dx},${playerStart.y + dy}`);
      }
    }

    // Create a 3x3 safe zone around the enemy's starting position (3,3)
    const enemyStart = { x: 3, y: 3 };
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        occupiedPositions.add(`${enemyStart.x + dx},${enemyStart.y + dy}`);
      }
    }

    for (let i = 0; i < numberOfWalls; i++) {
      let x, y;
      let positionKey: string;

      // Keep trying to find an unoccupied spot
      do {
        x = Math.floor(Math.random() * innerMapSize) + 1; // Random int from 1 to 13
        y = Math.floor(Math.random() * innerMapSize) + 1; // Random int from 1 to 13
        positionKey = `${x},${y}`;
      } while (occupiedPositions.has(positionKey));

      occupiedPositions.add(positionKey);
      this._gameEntities.push(new Wall(new Vector3(x, y, 0)));
    }
  };

  private resize = () => {
    this._width = window.innerWidth;
    this._height = window.innerHeight;
    this._renderer.setSize(this._width, this._height);
    this._camera.aspect = this._width / this._height;
    this._camera.updateProjectionMatrix();
  };

  public load = async () => {
    // load game resources
    await ResourceManager.instance.load();

    // load game entities
    for (let index = 0; index < this._gameEntities.length; index++) {
      const element = this._gameEntities[index];
      await element.load();
      this._scene.add(element.mesh);
    }
    // add a light to the scene
    const light = new HemisphereLight(0xffffbb, 0x080820, 1);
    this._scene.add(light);
  };

  public render = () => {
    if (this._isGameOver) {
      return; // Stop the game loop
    }

    requestAnimationFrame(this.render);
    // remove entities no longer needed
    this.disposeEntities();
    // obtain elapsed time between frams
    const deltaT = this._clock.getDelta();
    // update the tate of all entities
    for (let index = 0; index < this._gameEntities.length; index++) {
      const element = this._gameEntities[index];
      element.update(deltaT); /// ????
    }
    this._renderer.render(this._scene, this._camera);
  };

  // method to dynamically add entities to the scene
  public addToScene = (entity: GameEntity) => {
    this._gameEntities.push(entity);
    this._scene.add(entity.mesh);
  };

  // method to add and load a new entity to the scene
  public addAndLoadEntity = (entity: GameEntity) => {
    // Add the entity to the game loop immediately
    this._gameEntities.push(entity);
    // Load its assets and add its mesh to the scene when ready
    entity.load().then(() => {
      this._scene.add(entity.mesh);
    });
  };

  // method to increment the defeated enemies counter
  public incrementEnemiesDefeated = () => {
    this._enemiesDefeatedCount++;
    this._scoreElement.innerText = `Score: ${this._enemiesDefeatedCount}`;
    this._scoreElement.style.opacity = "1";

    // If there's an existing timer, clear it to reset the 5-second window
    if (this._scoreTimeoutId) {
      clearTimeout(this._scoreTimeoutId);
    }

    // Set a timer to hide the score after 5 seconds
    this._scoreTimeoutId = window.setTimeout(() => {
      this._scoreElement.style.opacity = "0";
    }, 5000);
  };

  public gameOver = () => {
    this._isGameOver = true;
    // Create a simple game over screen
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    overlay.style.color = "white";
    overlay.style.fontFamily = "sans-serif";
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.justifyContent = "center";
    overlay.style.alignItems = "center";

    const gameOverText = document.createElement("h1");
    gameOverText.style.fontSize = "3rem";
    gameOverText.style.margin = "0";
    gameOverText.innerText = "GAME OVER";

    const creditsText = document.createElement("p");
    creditsText.style.fontSize = "1.2rem";
    creditsText.style.margin = "0";
    creditsText.innerText = "tiles by @strideh.bsky.social";

    const finalScoreText = document.createElement("p");
    finalScoreText.style.fontSize = "1.5rem";
    finalScoreText.style.margin = "20px 0 0 0";
    finalScoreText.innerText = `Final Score: ${this._enemiesDefeatedCount}`;

    const redeemButton = document.createElement("button");
    redeemButton.innerText = "Redeem Score";
    redeemButton.style.marginTop = "20px";
    redeemButton.style.padding = "10px 20px";
    redeemButton.style.fontSize = "1.5rem";
    redeemButton.style.cursor = "pointer";
    redeemButton.style.border = "2px solid white";
    redeemButton.style.backgroundColor = "transparent";
    redeemButton.style.color = "white";
    redeemButton.onclick = async () => {
      // Access account and manifest from the window object
      const { account, manifest, redeem } = (window as any).dojo;
      if (account && manifest && redeem) {
        try {
          redeemButton.innerText = "Redeeming...";
          redeemButton.disabled = true;
          await redeem(account, manifest, this._enemiesDefeatedCount);
          redeemButton.innerText = "Score Redeemed!";
          redeemButton.style.backgroundColor = "#4CAF50";
        } catch (error) {
          console.error("Failed to redeem score:", error);
          redeemButton.innerText = "Redeem Failed";
          redeemButton.style.backgroundColor = "#f44336";
        }
      } else {
        console.error("Dojo account/manifest not found on window object.");
      }
    };

    const reloadButton = document.createElement("button");
    reloadButton.innerText = "Play Again";
    reloadButton.style.marginTop = "20px";
    reloadButton.style.marginLeft = "10px";
    reloadButton.style.padding = "10px 20px";
    reloadButton.style.fontSize = "1.5rem";
    reloadButton.style.cursor = "pointer";
    reloadButton.style.border = "2px solid white";
    reloadButton.style.backgroundColor = "transparent";
    reloadButton.style.color = "white";
    reloadButton.onclick = () => {
      window.location.reload();
    };

    overlay.appendChild(gameOverText);
    overlay.appendChild(finalScoreText);
    overlay.appendChild(creditsText);

    const buttonContainer = document.createElement("div");
    buttonContainer.style.marginTop = "20px";
    buttonContainer.appendChild(redeemButton);
    buttonContainer.appendChild(reloadButton);
    overlay.appendChild(buttonContainer);
    document.body.appendChild(overlay);
  };

  // method to remove entities no longer needed
  private disposeEntities = () => {
    const entitiesToBeDisposed = this._gameEntities.filter(
      (e) => e.shouldDispose
    );
    entitiesToBeDisposed.forEach((element) => {
      this._scene.remove(element.mesh);
      element.dispose();
    });
    // update entities array
    this._gameEntities = [
      ...this._gameEntities.filter((e) => !e.shouldDispose),
    ];
  };
}

export default GameScene;
