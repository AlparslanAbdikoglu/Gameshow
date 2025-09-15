#!/bin/bash

# Start containers in detached mode using existing images
docker-compose up -d

# Show running containers
docker ps

# Echo access info
echo "🎮 Gameshow started!"
echo "Control Panel: http://<VPS-IP>:8081/control"
echo "Game Display: http://<VPS-IP>:8081/gameshow"
