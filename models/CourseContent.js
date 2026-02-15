const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const CourseContent = sequelize.define(
    "CourseContent",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      course_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "courses", key: "id" },
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      content_type: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          isIn: [["video", "pdf", "link"]],
        },
      },
      content_url: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      order_index: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "course_content",
      timestamps: false,
    },
  );

  return CourseContent;
};
