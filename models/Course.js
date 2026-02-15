const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Course = sequelize.define(
    "Course",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      difficulty: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          isIn: [["beginner", "intermediate", "advanced"]],
        },
      },
      archetype: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          isIn: [["maker", "architect", "strategist", "connector", "explorer"]],
        },
      },
      estimated_hours: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      is_published: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      version: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "1.0",
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
    },
    {
      tableName: "courses",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  );

  return Course;
};
