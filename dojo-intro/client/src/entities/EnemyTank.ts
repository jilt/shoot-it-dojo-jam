import {
  Box3,
  Material,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Sphere,
  Vector3,
} from "three";
import GameEntity from "./GameEntity";
import ResourceManager from "../utils/ResourceManager";
import GameScene from "../scene/GameScene";
import Bullet from "./Bullet";
import ExplosionEffect from "../effects/ExplosionEffect";
import PlayerTank from "./PlayerTank";

class EnemyTank extends GameEntity {
  private _life = 100;
  private _rotation: number;
  private _moveSpeed = 1;

  // shooting state
  private _shootCooldown = 0;
  private _isShootingBurst = false;
  private _shotsFiredInBurst = 0;
  private _timeSinceLastBurstShot = 0;

  constructor(position: Vector3, moveSpeed?: number) {
    super(position, "enemy");
    // get a random starting rotation
    this._rotation = Math.floor(Math.random() * Math.PI * 2);
    if (moveSpeed) this._moveSpeed = moveSpeed;
  }

  private shoot = async () => {
    // create an offset position (shoot a bit ahead of the tank)
    const offset = new Vector3(
      Math.sin(this._rotation) * 0.45,
      -Math.cos(this._rotation) * 0.45,
      0.5
    );
    const shootingPosition = this._mesh.position.clone().add(offset);
    // create and load the bullet
    const bullet = new Bullet(shootingPosition, this._rotation, "enemy");
    GameScene.instance.addAndLoadEntity(bullet);

    // Reset burst timer
    this._timeSinceLastBurstShot = 0;
    this._shotsFiredInBurst++;
  };

  public load = async () => {
    // ask the models and textures to the resource manager
    const tankModel = ResourceManager.instance.getModel("tank");
    if (!tankModel) {
      throw "unable to get tank model";
    }

    // entities using models will require a unique instance
    const tankSceneData = tankModel.scene.clone();

    // the model contains the meshes we need for the scene
    const tankBodyMesh = tankSceneData.children.find(
      (m) => m.name === "Body"
    ) as Mesh;

    const tankTurretMesh = tankSceneData.children.find(
      (m) => m.name === "Turret"
    ) as Mesh;

    const tankBodyTexture =
      ResourceManager.instance.getTexture("tank-body-red");
    const tankTurretTexture =
      ResourceManager.instance.getTexture("tank-turret-red");

    if (
      !tankBodyMesh ||
      !tankTurretMesh ||
      !tankBodyTexture ||
      !tankTurretTexture
    ) {
      throw "unable to load player model or textures";
    }

    // with all the assets we can build the final mesh and materials
    const bodyMaterial = new MeshStandardMaterial({
      map: tankBodyTexture,
    });
    const turretMaterial = new MeshStandardMaterial({
      map: tankTurretTexture,
    });

    tankBodyMesh.material = bodyMaterial;
    tankTurretMesh.material = turretMaterial;

    // add meshes as child of entity mesh
    this._mesh.add(tankBodyMesh);
    this._mesh.add(tankTurretMesh);

    // create the collider for the tank
    const collider = new Box3()
      .setFromObject(this._mesh)
      .getBoundingSphere(new Sphere(this._mesh.position.clone()));
    // this creates a sphere around the tank which is easier to calculate with other collisions
    // reduce the radius a bit
    collider.radius *= 0.75;
    this._collider = collider;
  };

  public update = (deltaT: number) => {
    // Update cooldowns
    this._shootCooldown -= deltaT;
    this._timeSinceLastBurstShot += deltaT;

    // --- Shooting Logic ---
    const player = GameScene.instance.gameEntities.find(
      (e) => e.entityType === "player"
    ) as PlayerTank;

    if (player && this._shootCooldown <= 0 && !this._isShootingBurst) {
      const vectorToPlayer = player.mesh.position
        .clone()
        .sub(this._mesh.position);
      const enemyForwardVector = new Vector3(
        Math.sin(this._rotation),
        -Math.cos(this._rotation),
        0
      );

      // Check if the player is in the line of sight
      const angle = enemyForwardVector.angleTo(vectorToPlayer);
      if (angle < 0.2) {
        // Angle is small enough, start shooting burst
        this._isShootingBurst = true;
        this._shotsFiredInBurst = 0;
        this._timeSinceLastBurstShot = 0;
      }
    }

    // Handle the 3-shot burst
    if (this._isShootingBurst) {
      const burstShotDelay = 0.2; // 200ms between shots in a burst
      if (
        this._shotsFiredInBurst < 5 &&
        this._timeSinceLastBurstShot > burstShotDelay
      ) {
        this.shoot();
      } else if (this._shotsFiredInBurst >= 5) {
        // Burst is over, reset and start cooldown
        this._isShootingBurst = false;
        this._shotsFiredInBurst = 0;
        this._shootCooldown = 3; // 3-second cooldown until next burst
      }
    }

    // --- Movement Logic ---
    const computedMovement = new Vector3(
      this._moveSpeed * deltaT * Math.sin(this._rotation),
      -this._moveSpeed * deltaT * Math.cos(this._rotation),
      0
    );

    // build testing collider
    const testingSphere = new Sphere(
      (this._collider as Sphere).clone().center,
      (this._collider as Sphere).clone().radius
    );
    testingSphere.center.add(computedMovement);

    // check for valid colliders
    const colliders = GameScene.instance.gameEntities.filter(
      (c) =>
        c !== this &&
        c.collider &&
        c.collider!.intersectsSphere(testingSphere) &&
        c.entityType !== "bullet"
    );

    if (colliders.length) {
      // If moving forward is blocked, pick a new random rotation
      this._rotation = Math.floor(Math.random() * Math.PI * 2);
      return;
    }

    // no collisions, can update position, collider and rotation
    this._mesh.position.add(computedMovement);
    (this._collider as Sphere).center.add(computedMovement);
    this._mesh.setRotationFromAxisAngle(new Vector3(0, 0, 1), this._rotation);
  };

  public damage = (amount: number) => {
    this._life -= amount;
    if (this._life <= 0) {
      this._shouldDispose = true;
      const explosion = new ExplosionEffect(this._mesh.position, 2);
      explosion.load().then(() => {
        GameScene.instance.addToScene(explosion);
      });
    }
  };

  public dispose = () => {
    // when an enemy tank is disposed, create a new one that is faster
    const newMoveSpeed = this._moveSpeed + 1;
    const mapSize = GameScene.instance.mapSize; // e.g., 15
    const tankRadius = 0.75; // Based on collider.radius *= 0.75;

    let newPosition: Vector3;
    let isPositionSafe = false;

    // Keep generating positions until we find one that is not inside a wall or other entity
    while (!isPositionSafe) {
      // Generate a position away from the edges to avoid spawning in walls
      const x = MathUtils.randInt(1, mapSize - 2);
      const y = MathUtils.randInt(1, mapSize - 2);
      newPosition = new Vector3(x, y, 0);

      // Create a temporary sphere to test for collisions at the new position
      const testSphere = new Sphere(newPosition, tankRadius);

      // Check if this position intersects with any existing colliders
      const intersectingColliders = GameScene.instance.gameEntities.filter(
        (entity) =>
          entity.collider && entity.collider.intersectsSphere(testSphere)
      );

      if (intersectingColliders.length === 0) {
        isPositionSafe = true;
      }
    }

    const newEnemy = new EnemyTank(newPosition!, newMoveSpeed);
    GameScene.instance.addAndLoadEntity(newEnemy);
    GameScene.instance.incrementEnemiesDefeated();

    this._mesh.children.forEach((c) => {
      (c as Mesh).geometry.dispose();
      ((c as Mesh).material as Material).dispose();
    });
    this._mesh.clear(); // Use clear() for better performance and safety
  };
}

export default EnemyTank;
