const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const CourseSkill = sequelize.define(
    "CourseSkill",
    {
      course_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: "courses", key: "id" },
      },
      skill_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: "skills", key: "id" },
      },
      weight: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 1.0,
      },
    },
    {
      tableName: "course_skills",
      timestamps: false,
    },
  );

  return CourseSkill;
};
